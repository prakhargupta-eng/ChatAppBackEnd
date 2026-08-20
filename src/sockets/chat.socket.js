// In-memory mapping of userId to socket.id
const connectedUsers = new Map();

const initChatSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Client emits 'register' with their userId after connecting
    socket.on('register', (userId) => {
      connectedUsers.set(userId, socket.id);
      console.log(`User ${userId} registered with socket ${socket.id}`);
      // Acknowledge registration
      socket.emit('registered', { status: 'success' });
    });

    // 1. Sending a message
    socket.on('send_message', (data) => {
      // data: { to: 'userB_id', content: 'hello', messageId: '123', from: 'userA_id' }
      const { to, content, messageId, from } = data;

      // Immediately acknowledge to sender that message is sent (Single tick)
      socket.emit('message_status', { messageId, status: 'sent', to });

      // Check if recipient is connected
      const recipientSocketId = connectedUsers.get(to);
      if (recipientSocketId) {
        // Forward message to recipient
        io.to(recipientSocketId).emit('receive_message', {
          messageId,
          content,
          from,
          timestamp: new Date()
        });
      } else {
        // Here you might typically save to DB as 'pending'. 
        // For this temporary app, we just log it or notify the sender.
        console.log(`User ${to} is offline. Message not delivered.`);
      }
    });

    // 2. Message Delivered
    socket.on('message_delivered', (data) => {
      // data: { messageId: '123', from: 'userA_id', to: 'userB_id' } (from is the original sender)
      const { messageId, from } = data;
      const senderSocketId = connectedUsers.get(from);

      if (senderSocketId) {
        // Forward 'delivered' status to original sender (Double tick)
        io.to(senderSocketId).emit('message_status', { messageId, status: 'delivered', to: data.to });
      }
    });

    // 3. Message Read
    socket.on('message_read', (data) => {
      // data: { messageId: '123', from: 'userA_id', to: 'userB_id' }
      const { messageId, from } = data;
      const senderSocketId = connectedUsers.get(from);

      if (senderSocketId) {
        // Forward 'read' status to original sender (Blue double tick)
        io.to(senderSocketId).emit('message_status', { messageId, status: 'read', to: data.to });
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
          break;
        }
      }
    });
  });
};

module.exports = initChatSocket;
