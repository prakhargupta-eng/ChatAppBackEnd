const Message = require('../models/message.model');
const User = require('../models/user.model');
const { getMessaging } = require('firebase-admin/messaging');

// In-memory mapping of userId to a Set of socket.ids (Supports multi-device)
const connectedUsers = new Map();
const activeChats = new Map();
const rateLimits = new Map();

function isRateLimited(socketId, event, delayMs = 400) {
  const key = `${socketId}_${event}`;
  const now = Date.now();
  if (rateLimits.has(key)) {
     if (now - rateLimits.get(key) < delayMs) {
         return true; // Rate limited
     }
  }
  rateLimits.set(key, now);
  return false;
}
const SOCKET_EVENTS = {
  REGISTER: 'register',
  REGISTERED: 'registered',
  USER_ONLINE: 'user_online',
  USER_OFFLINE: 'user_offline',
  SEND_MESSAGE: 'send_message',
  MESSAGE_STATUS: 'message_status',
  NEW_MESSAGE: 'new_message',
  MESSAGE_DELIVERED: 'message_delivered',
  MESSAGE_READ: 'message_read',
  TYPING: 'typing',
  STOP_TYPING: 'stop_typing',
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
};




async function processSingleMessage(io, socket, data) {
      console.log('[SOCKET EVENT] processing message', data.messageId);
      
      const { messageId, conversationId, senderId, receiverId, text, createdAt, type } = data;
      let { senderName, receiverName } = data;

      // Save message to database
      try {
        if (!senderName || !receiverName) {
          const [sender, receiver] = await Promise.all([
            User.findById(senderId),
            User.findById(receiverId)
          ]);
          if (sender) senderName = sender.username;
          if (receiver) receiverName = receiver.username;
        }

        const newMessage = new Message({
          messageId,
          conversationId,
          senderId,
          senderName,
          receiverId,
          receiverName,
          text,
          type: type || 'text',
          status: 'sent',
          createdAt: createdAt || new Date()
        });
        await newMessage.save();
      } catch (err) {
        console.error('Error saving message to DB:', err);
      }

      socket.emit(SOCKET_EVENTS.MESSAGE_STATUS, { messageId, status: 'sent', receiverId, conversationId });

      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      let isRecipientActiveInChat = false;

      if (recipientSockets && recipientSockets.size > 0) {
        for (const sockId of recipientSockets) {
          io.to(sockId).emit(SOCKET_EVENTS.NEW_MESSAGE, {
            messageId,
            conversationId,
            senderId,
            receiverId,
            text,
            createdAt,
            type
          });
          if (activeChats.get(sockId) === String(conversationId)) {
            isRecipientActiveInChat = true;
          }
        }
      } 
      
      if (!isRecipientActiveInChat) {
        console.log(`User ${receiverId} is not actively viewing chat. Attempting to send Push Notification...`);
        try {
          const receiver = await User.findById(receiverId);
          if (receiver && receiver.fcmToken) {
            await getMessaging().send({
              token: receiver.fcmToken,
              notification: {
                title: senderName || 'New Message',
                body: text
              },
              data: {
                conversationId: String(conversationId || ''),
                senderId: String(senderId || ''),
                messageId: String(messageId || ''),
                custom_content_type: '1',
                article_id: '12345'
              },
              apns: {
                headers: {
                  'apns-push-type': 'alert',
                  'apns-priority': '10'
                },
                payload: {
                  aps: {
                    alert: {
                      title: senderName || 'New Message',
                      body: text
                    },
                    sound: 'new_Notification.wav',
                    badge: 1,
                    'mutable-content': 1
                  }
                }
              }
            });
            console.log(`[PUSH NOTIFICATION] Sent to user ${receiverId}.`);
          } else {
            console.log(`User ${receiverId} does not have an FCM token registered.`);
          }
        } catch (pushErr) {
          console.error(`Failed to send push notification to user ${receiverId}:`, pushErr);
        }
      }
}

const initChatSocket = (io) => {

  io.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Client emits 'register' with their userId after connecting
    socket.on(SOCKET_EVENTS.REGISTER, async (payload) => {
      // In case the frontend sends an object instead of a string
      let userId = payload;
      if (payload && typeof payload === 'object') {
        userId = payload.userId || payload.id;
      }
      userId = String(userId);

      if (!connectedUsers.has(userId)) {
        connectedUsers.set(userId, new Set());
      }
      connectedUsers.get(userId).add(socket.id);
      console.log(`User ${userId} registered with socket ${socket.id}`);
      
      // Acknowledge registration and send the list of currently online users
      const onlineUsers = Array.from(connectedUsers.keys());
      socket.emit(SOCKET_EVENTS.REGISTERED, { status: 'success', onlineUsers });
      
      // Notify others that this user is online ONLY if this is their first device connecting
      if (connectedUsers.get(userId).size === 1) {
        socket.broadcast.emit(SOCKET_EVENTS.USER_ONLINE, { userId });
      }

      // Automatically deliver any messages that were sent while the user was offline
      try {
        const undeliveredMessages = await Message.find({ receiverId: userId, status: 'sent' });
        if (undeliveredMessages.length > 0) {
          console.log(`Found ${undeliveredMessages.length} undelivered messages for user ${userId}. Delivering now.`);
          for (const msg of undeliveredMessages) {
             socket.emit(SOCKET_EVENTS.NEW_MESSAGE, {
                messageId: msg.messageId,
                conversationId: msg.conversationId,
                senderId: msg.senderId,
                receiverId: msg.receiverId,
                text: msg.text,
                createdAt: msg.createdAt,
                type: msg.type
             });
             
             // Update status in DB to delivered
             msg.status = 'delivered';
             await msg.save();
             
             // Notify the original sender that it was delivered
             const originalSenderSockets = connectedUsers.get(String(msg.senderId));
             if (originalSenderSockets) {
                for (const sockId of originalSenderSockets) {
                   io.to(sockId).emit(SOCKET_EVENTS.MESSAGE_DELIVERED, { 
                     messageId: msg.messageId, 
                     receiverId: userId, 
                     conversationId: msg.conversationId 
                   });
                }
             }
          }
        }
      } catch (err) {
        console.error('Error fetching undelivered messages on register:', err);
      }
    });


    // Frontend manually setting themselves online (fallback / coming to foreground)
    socket.on(SOCKET_EVENTS.USER_ONLINE, (payload) => {
      console.log('[SOCKET EVENT] user_online (manual)', payload);
      let userId = payload && typeof payload === 'object' ? (payload.userId || payload.id) : payload;
      userId = String(userId);

      if (!connectedUsers.has(userId)) {
        connectedUsers.set(userId, new Set());
      }
      connectedUsers.get(userId).add(socket.id);
      
      if (connectedUsers.get(userId).size === 1) {
        socket.broadcast.emit(SOCKET_EVENTS.USER_ONLINE, { userId });
      }
    });

    // Frontend manually setting themselves offline (fallback / going to background)
    socket.on(SOCKET_EVENTS.USER_OFFLINE, (payload) => {
      console.log('[SOCKET EVENT] user_offline (manual)', payload);
      let userId = payload && typeof payload === 'object' ? (payload.userId || payload.id) : payload;
      userId = String(userId);

      const sockets = connectedUsers.get(userId);
      if (sockets && sockets.has(socket.id)) {
        sockets.delete(socket.id);
        
        if (sockets.size === 0) {
          connectedUsers.delete(userId);
          socket.broadcast.emit(SOCKET_EVENTS.USER_OFFLINE, { userId });
        }
      }
    });

    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (data) => {
      if (isRateLimited(socket.id, SOCKET_EVENTS.SEND_MESSAGE, 400)) {
         console.log('Rate limited SEND_MESSAGE for socket', socket.id);
         return;
      }
      await processSingleMessage(io, socket, data);
    });

    socket.on('sync_offline_messages', async (data) => {
      const { messages } = data;
      if (!messages || !Array.isArray(messages)) return;
      
      for (const msg of messages) {
         await processSingleMessage(io, socket, msg);
      }
    });

    socket.on('active_chat', (payload) => {
      if (payload && payload.conversationId) {
        activeChats.set(socket.id, String(payload.conversationId));
      } else {
        activeChats.delete(socket.id);
      }
    });

    // 2. Message Delivered
    socket.on(SOCKET_EVENTS.MESSAGE_DELIVERED, async (data) => {
      console.log('[SOCKET EVENT] message_delivered', data);
      const { messageId, senderId, receiverId, conversationId } = data;
      
      try {
        await Message.findOneAndUpdate({ messageId }, { status: 'delivered' });
      } catch (err) {
        console.error('Error updating message status to delivered:', err);
      }

      const safeSenderId = String(senderId);
      const originalSenderSockets = connectedUsers.get(safeSenderId);

      if (originalSenderSockets) {
        // Forward 'delivered' status to all of original sender's devices (Double tick)
        for (const sockId of originalSenderSockets) {
          io.to(sockId).emit(SOCKET_EVENTS.MESSAGE_DELIVERED, { messageId, receiverId, conversationId });
        }
      }
    });

    // 3. Message Read
    socket.on(SOCKET_EVENTS.MESSAGE_READ, async (data) => {
      console.log('[SOCKET EVENT] message_read', data);
      const { messageId, senderId, receiverId, conversationId } = data;

      try {
        await Message.findOneAndUpdate({ messageId }, { status: 'read' });
      } catch (err) {
        console.error('Error updating message status to read:', err);
      }

      const safeSenderId = String(senderId);
      const originalSenderSockets = connectedUsers.get(safeSenderId);

      if (originalSenderSockets) {
        // Forward 'read' status to all of original sender's devices (Blue double tick)
        for (const sockId of originalSenderSockets) {
          io.to(sockId).emit(SOCKET_EVENTS.MESSAGE_READ, { messageId, receiverId, conversationId });
        }
      }
    });

    // 4. Typing Events
    socket.on(SOCKET_EVENTS.TYPING, (data) => {
      if (isRateLimited(socket.id, SOCKET_EVENTS.TYPING, 400)) return;
      console.log('[SOCKET EVENT] typing', data);
      const { senderId, receiverId, conversationId } = data;
      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets) {
        for (const sockId of recipientSockets) {
          io.to(sockId).emit(SOCKET_EVENTS.TYPING, { senderId, conversationId });
        }
      }
    });

    socket.on(SOCKET_EVENTS.STOP_TYPING, (data) => {
      console.log('[SOCKET EVENT] stop_typing', data);
      const { senderId, receiverId, conversationId } = data;
      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets) {
        for (const sockId of recipientSockets) {
          io.to(sockId).emit(SOCKET_EVENTS.STOP_TYPING, { senderId, conversationId });
        }
      }
    });

    // Handle disconnect
    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
      console.log(`User disconnected: ${socket.id}`);
      activeChats.delete(socket.id);
      // Remove from map
      for (let [userId, sockets] of connectedUsers.entries()) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          console.log(`Removed socket ${socket.id} from user ${userId}`);
          
          if (sockets.size === 0) {
            connectedUsers.delete(userId);
            console.log(`User ${userId} fully offline`);
            // Notify others that this user is completely offline
            socket.broadcast.emit(SOCKET_EVENTS.USER_OFFLINE, { userId });
          }
          break;
        }
      }
    });
  });
};

module.exports = initChatSocket;
