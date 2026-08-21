const Message = require('../models/message.model');
const User = require('../models/user.model');
const { admin } = require('../config/firebase');

// In-memory mapping of userId to a Set of socket.ids (Supports multi-device)
const connectedUsers = new Map();

const initChatSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Client emits 'register' with their userId after connecting
    socket.on('register', (payload) => {
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
      socket.emit('registered', { status: 'success', onlineUsers });
      
      // Notify others that this user is online ONLY if this is their first device connecting
      if (connectedUsers.get(userId).size === 1) {
        socket.broadcast.emit('user_online', { userId });
      }
    });

    // 1. Sending a message
    socket.on('send_message', async (data) => {
      console.log('[SOCKET EVENT] send_message', data);
      
      const { messageId, conversationId, senderId, receiverId, text, createdAt, type } = data;
      let { senderName, receiverName } = data;

      // Save message to database
      try {
        // If frontend didn't send names, fetch them from DB
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

      // Immediately acknowledge to sender that message is sent (Single tick)
      socket.emit('message_status', { messageId, status: 'sent', receiverId, conversationId });

      // Check if recipient is connected
      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets && recipientSockets.size > 0) {
        // Forward message to all of recipient's connected devices
        for (const sockId of recipientSockets) {
          io.to(sockId).emit('new_message', {
            messageId,
            conversationId,
            senderId,
            receiverId,
            text,
            createdAt,
            type
          });
        }
      } else {
        console.log(`User ${receiverId} is offline. Attempting to send Push Notification...`);
        try {
          const receiver = await User.findById(receiverId);
          if (receiver && receiver.fcmToken) {
            await admin.messaging().send({
              token: receiver.fcmToken,
              notification: {
                title: senderName || 'New Message',
                body: text
              },
              data: {
                conversationId: String(conversationId || ''),
                senderId: String(senderId || ''),
                messageId: String(messageId || '')
              }
            });
            console.log(`Push notification sent to user ${receiverId}`);
          } else {
            console.log(`User ${receiverId} does not have an FCM token registered.`);
          }
        } catch (pushErr) {
          console.error(`Failed to send push notification to user ${receiverId}:`, pushErr);
        }
      }
    });

    // 2. Message Delivered
    socket.on('message_delivered', async (data) => {
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
          io.to(sockId).emit('message_delivered', { messageId, receiverId, conversationId });
        }
      }
    });

    // 3. Message Read
    socket.on('message_read', async (data) => {
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
          io.to(sockId).emit('message_read', { messageId, receiverId, conversationId });
        }
      }
    });

    // 4. Typing Events
    socket.on('typing', (data) => {
      console.log('[SOCKET EVENT] typing', data);
      const { senderId, receiverId, conversationId } = data;
      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets) {
        for (const sockId of recipientSockets) {
          io.to(sockId).emit('typing', { senderId, conversationId });
        }
      }
    });

    socket.on('stop_typing', (data) => {
      console.log('[SOCKET EVENT] stop_typing', data);
      const { senderId, receiverId, conversationId } = data;
      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets) {
        for (const sockId of recipientSockets) {
          io.to(sockId).emit('stop_typing', { senderId, conversationId });
        }
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      // Remove from map
      for (let [userId, sockets] of connectedUsers.entries()) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          console.log(`Removed socket ${socket.id} from user ${userId}`);
          
          if (sockets.size === 0) {
            connectedUsers.delete(userId);
            console.log(`User ${userId} fully offline`);
            // Notify others that this user is completely offline
            socket.broadcast.emit('user_offline', { userId });
          }
          break;
        }
      }
    });
  });
};

module.exports = initChatSocket;
