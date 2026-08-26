const Call = require('../models/call.model');

const getCallHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const calls = await Call.find({
      $or: [{ callerId: userId }, { receiverId: userId }]
    })
    .sort({ createdAt: -1 })
    .populate('callerId', 'username profilePic')
    .populate('receiverId', 'username profilePic');
    
    res.status(200).json({ calls });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findOne({ callId })
      .populate('callerId', 'username profilePic')
      .populate('receiverId', 'username profilePic');

    if (!call) return res.status(404).json({ error: 'Call not found' });
    if (String(call.callerId._id) !== userId && String(call.receiverId._id) !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.status(200).json({ call });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteCallHistory = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findOne({ callId });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    if (String(call.callerId) !== userId && String(call.receiverId) !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await Call.deleteOne({ callId });
    res.status(200).json({ message: 'Call record deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getCallHistory, getCallDetails, deleteCallHistory };
