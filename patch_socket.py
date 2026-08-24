import sys

filepath = 'src/sockets/chat.socket.js'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Add activeChats and rateLimits
content = content.replace(
    'const connectedUsers = new Map();',
    """const connectedUsers = new Map();
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
}"""
)

# 2. Add processSingleMessage
process_func = """
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
"""

content = content.replace('const initChatSocket = (io) => {', process_func)

# 3. Replace SEND_MESSAGE logic and add debounce check
send_msg_old = """    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (data) => {
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
      socket.emit(SOCKET_EVENTS.MESSAGE_STATUS, { messageId, status: 'sent', receiverId, conversationId });

      // Check if recipient is connected
      const safeReceiverId = String(receiverId);
      const recipientSockets = connectedUsers.get(safeReceiverId);
      if (recipientSockets && recipientSockets.size > 0) {
        // Forward message to all of recipient's connected devices
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
        }
      } else {
        console.log(`User ${receiverId} is offline. Attempting to send Push Notification...`);
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
            console.log(`[PUSH NOTIFICATION] Sent to user ${receiverId} (Username: ${receiver.username}). Message: "${text}"`);
          } else {
            console.log(`User ${receiverId} does not have an FCM token registered.`);
          }
        } catch (pushErr) {
          console.error(`Failed to send push notification to user ${receiverId}:`, pushErr);
        }
      }
    });"""

send_msg_new = """    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (data) => {
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
    });"""

content = content.replace(send_msg_old, send_msg_new)

# 4. Handle TYPING debounce
typing_old = """    socket.on(SOCKET_EVENTS.TYPING, (data) => {
      console.log('[SOCKET EVENT] typing', data);"""
typing_new = """    socket.on(SOCKET_EVENTS.TYPING, (data) => {
      if (isRateLimited(socket.id, SOCKET_EVENTS.TYPING, 400)) return;
      console.log('[SOCKET EVENT] typing', data);"""
content = content.replace(typing_old, typing_new)

# 5. Handle disconnect
content = content.replace(
    'socket.on(SOCKET_EVENTS.DISCONNECT, () => {\n      console.log(`User disconnected: ${socket.id}`);',
    'socket.on(SOCKET_EVENTS.DISCONNECT, () => {\n      console.log(`User disconnected: ${socket.id}`);\n      activeChats.delete(socket.id);'
)

with open(filepath, 'w') as f:
    f.write(content)
print("Done patching.")
