const Message = require('../models/message.model');

const getChatHistory = async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Fetch all messages for this conversation, sorted by creation time (oldest to newest)
    const messages = await Message.find({ conversationId }).sort({ createdAt: 1 });
    
    res.status(200).json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUndeliveredMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find all messages sent TO this user that are still marked as 'sent' (not 'delivered' or 'read')
    const messages = await Message.find({ receiverId: userId, status: 'sent' }).sort({ createdAt: 1 });
    
    res.status(200).json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getChatHistory, getUndeliveredMessages };
