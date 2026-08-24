import sys

filepath = 'src/sockets/chat.socket.js'
with open(filepath, 'r') as f:
    content = f.read()

register_old = """    socket.on(SOCKET_EVENTS.REGISTER, (payload) => {
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
    });"""

register_new = """    socket.on(SOCKET_EVENTS.REGISTER, async (payload) => {
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
    });"""

content = content.replace(register_old, register_new)

with open(filepath, 'w') as f:
    f.write(content)
print("Done patching register.")
