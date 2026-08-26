const Message = require('../models/message.model');
const User = require('../models/user.model');
const { getMessaging } = require('firebase-admin/messaging');

// In-memory mapping of userId to a Set of socket.ids (Supports multi-device)
const connectedUsers = new Map();
const activeChats = new Map();

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
  CURRENT_CHAT_USER: 'current_chat_user',
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
};




async function processSingleMessage(io, socket, data) {
      const crypto = require('crypto');
      const messageId = data.messageId || data.id || data._id || crypto.randomUUID();
      console.log('[SOCKET EVENT] processing message', messageId);
      
      const { conversationId, senderId, receiverId, text, createdAt, type } = data;
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
              android: {
                notification: {
                  tag: String(messageId),
                  channelId: "custom_sound_channel",
                  sound: "new_notification"
                }
              },
              apns: {
                headers: {
                  'apns-push-type': 'alert',
                  'apns-priority': '10',
                  'apns-collapse-id': String(messageId)
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
          if (pushErr.code === 'messaging/registration-token-not-registered') {
             // The token is dead/expired. Remove it from the database so we stop attempting.
             User.findByIdAndUpdate(receiverId, { $unset: { fcmToken: "" } })
               .then(() => console.log(`Removed dead FCM token for user ${receiverId}`))
               .catch(err => console.error('Failed to remove dead FCM token:', err));
          }
        }
      }
}

const initChatSocket = (io) => {

  io.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    console.log(`[SOCKET CONNECTED] A new device connected with temporary ID: ${socket.id}`);

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
      
      try {
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown';
        console.log(`User ${userId} (${username}) registered with socket ${socket.id}`);
      } catch (err) {
        console.log(`User ${userId} registered with socket ${socket.id}`);
      }
      
      // We will acknowledge registration further down, after fetching contacts
      
      // Target presence: Only notify people who have actually chatted with this user
      let contactIds = new Set();
      try {
        const distinctConvos = await Message.distinct('conversationId', {
          $or: [{ senderId: userId }, { receiverId: userId }]
        });
        for (const convoId of distinctConvos) {
          const parts = convoId.split('_');
          if (parts.length === 2) {
            contactIds.add(parts[0] === String(userId) ? parts[1] : parts[0]);
          }
        }
      } catch (e) {
        console.error('Error fetching contacts for presence', e);
      }

      // Notify contacts that this user is online ONLY if this is their first device connecting
      if (connectedUsers.get(userId)?.size === 1) {
        for (const contactId of contactIds) {
          const contactSockets = connectedUsers.get(contactId);
          if (contactSockets) {
            for (const sockId of contactSockets) {
              io.to(sockId).emit(SOCKET_EVENTS.USER_ONLINE, { userId });
            }
          }
        }
      }

      // Let this newly registered user know about their contacts who are already online
      // We also build an array to send in the REGISTERED payload so the frontend requires ZERO changes
      const onlineContacts = [];
      for (const contactId of contactIds) {
        if (connectedUsers.has(contactId)) {
          onlineContacts.push(contactId);
          socket.emit(SOCKET_EVENTS.USER_ONLINE, { userId: contactId });
        }
      }

      // Acknowledge registration and send the filtered list of online contacts
      socket.emit(SOCKET_EVENTS.REGISTERED, { status: 'success', onlineUsers: onlineContacts });

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
    socket.on(SOCKET_EVENTS.USER_ONLINE, async (payload) => {
      console.log('[SOCKET EVENT] user_online (manual)', payload);
      let userId = payload && typeof payload === 'object' ? (payload.userId || payload.id) : payload;
      userId = String(userId);

      if (!connectedUsers.has(userId)) {
        connectedUsers.set(userId, new Set());
      }
      connectedUsers.get(userId).add(socket.id);
      
      let contactIds = new Set();
      try {
        const distinctConvos = await Message.distinct('conversationId', {
          $or: [{ senderId: userId }, { receiverId: userId }]
        });
        for (const convoId of distinctConvos) {
          const parts = convoId.split('_');
          if (parts.length === 2) {
            contactIds.add(parts[0] === String(userId) ? parts[1] : parts[0]);
          }
        }
      } catch (e) {}

      if (connectedUsers.get(userId)?.size === 1) {
        for (const contactId of contactIds) {
          const contactSockets = connectedUsers.get(contactId);
          if (contactSockets) {
            for (const sockId of contactSockets) {
              io.to(sockId).emit(SOCKET_EVENTS.USER_ONLINE, { userId });
            }
          }
        }
      }

      for (const contactId of contactIds) {
        if (connectedUsers.has(contactId)) {
          socket.emit(SOCKET_EVENTS.USER_ONLINE, { userId: contactId });
        }
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
      await processSingleMessage(io, socket, data);
    });

    socket.on('sync_offline_messages', async (data) => {
      const { messages } = data;
      if (!messages || !Array.isArray(messages)) return;
      
      for (const msg of messages) {
         await processSingleMessage(io, socket, msg);
      }

      // Notify the frontend that all offline messages have been processed
      socket.emit('local_queue_flushed', { status: 'success' });
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

    // 5. Current Chat User Status
    socket.on(SOCKET_EVENTS.CURRENT_CHAT_USER, (data) => {
      // console.log('[SOCKET EVENT] current_chat_user', data);
      const { senderId, receiverId, isChatOpen, conversationId } = data;
      
      // Bind to push notification tracking
      if (isChatOpen && conversationId) {
        activeChats.set(socket.id, String(conversationId));
      } else {
        activeChats.delete(socket.id);
      }

      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets) {
        for (const sockId of recipientSockets) {
          io.to(sockId).emit(SOCKET_EVENTS.CURRENT_CHAT_USER, { 
            senderId, 
            isChatOpen 
          });
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
            console.log('4. Unexpected Drop (The DISCONNECT Event) forces fully kill the app');
            
            // Notify only contacts that this user is completely offline
            Message.distinct('conversationId', {
              $or: [{ senderId: userId }, { receiverId: userId }]
            }).then(distinctConvos => {
              const contactIds = new Set();
              for (const convoId of distinctConvos) {
                const parts = convoId.split('_');
                if (parts.length === 2) {
                  contactIds.add(parts[0] === String(userId) ? parts[1] : parts[0]);
                }
              }
              for (const contactId of contactIds) {
                const contactSockets = connectedUsers.get(contactId);
                if (contactSockets) {
                  for (const sockId of contactSockets) {
                    io.to(sockId).emit(SOCKET_EVENTS.USER_OFFLINE, { userId });
                  }
                }
              }
            }).catch(e => console.error('Error fetching contacts on offline', e));
          }
          break;
        }
      }
    });
  });
};

module.exports = { initChatSocket, connectedUsers };
