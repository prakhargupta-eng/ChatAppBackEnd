// In-memory mapping of userId to socket.id
const connectedUsers = new Map();

const initChatSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Client emits 'register' with their userId after connecting
    socket.on('register', (userId) => {
      connectedUsers.set(userId, socket.id);
      console.log(`User ${userId} registered with socket ${socket.id}`);
      // Acknowledge registration and send the list of currently online users
      const onlineUsers = Array.from(connectedUsers.keys());
      socket.emit('registered', { status: 'success', onlineUsers });
      
      // Notify others that this user is online
      socket.broadcast.emit('user_online', { userId });
    });

    // 1. Sending a message
    socket.on('send_message', (data) => {
      console.log('[SOCKET EVENT] send_message', data);
      /*
        Expected data format:
        {
          messageId: "msg_123",
          conversationId: "conversation_456",
          senderId: "user_A",
          receiverId: "user_B",
          text: "Hello Rahul",
          createdAt: "2026-08-20T07:30:00Z",
          type: "text" // text/ audio/ video/none
        }
      */
      const { messageId, conversationId, senderId, receiverId, text, createdAt, type } = data;

      // Immediately acknowledge to sender that message is sent (Single tick)
      socket.emit('message_status', { messageId, status: 'sent', receiverId, conversationId });

      // Check if recipient is connected
      const recipientSocketId = connectedUsers.get(receiverId);
      if (recipientSocketId) {
        // Forward message to recipient using 'new_message' event
        io.to(recipientSocketId).emit('new_message', {
          messageId,
          conversationId,
          senderId,
          receiverId,
          text,
          createdAt,
          type
        });
      } else {
        console.log(`User ${receiverId} is offline. Message not delivered.`);
      }
    });

    // 2. Message Delivered
    socket.on('message_delivered', (data) => {
      console.log('[SOCKET EVENT] message_delivered', data);
      const { messageId, senderId, receiverId, conversationId } = data;
      const originalSenderSocketId = connectedUsers.get(senderId);

      if (originalSenderSocketId) {
        // Forward 'delivered' status to original sender (Double tick)
        io.to(originalSenderSocketId).emit('message_delivered', { messageId, receiverId, conversationId });
      }
    });

    // 3. Message Read
    socket.on('message_read', (data) => {
      console.log('[SOCKET EVENT] message_read', data);
      const { messageId, senderId, receiverId, conversationId } = data;
      const originalSenderSocketId = connectedUsers.get(senderId);

      if (originalSenderSocketId) {
        // Forward 'read' status to original sender (Blue double tick)
        io.to(originalSenderSocketId).emit('message_read', { messageId, receiverId, conversationId });
      }
    });

    // 4. Typing Events
    socket.on('typing', (data) => {
      console.log('[SOCKET EVENT] typing', data);
      const { senderId, receiverId, conversationId } = data;
      const recipientSocketId = connectedUsers.get(receiverId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('typing', { senderId, conversationId });
      }
    });

    socket.on('stop_typing', (data) => {
      console.log('[SOCKET EVENT] stop_typing', data);
      const { senderId, receiverId, conversationId } = data;
      const recipientSocketId = connectedUsers.get(receiverId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('stop_typing', { senderId, conversationId });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      // Remove from map
      for (let [userId, sockId] of connectedUsers.entries()) {
        if (sockId === socket.id) {
          connectedUsers.delete(userId);
          console.log(`Removed user ${userId} from registry`);
          
          // Notify others that this user is offline
          socket.broadcast.emit('user_offline', { userId });
          break;
        }
      }
    });
  });
};

module.exports = initChatSocket;
