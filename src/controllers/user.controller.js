const User = require('../models/user.model');
const { getMessaging } = require('firebase-admin/messaging');

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } }).select('-password');
    res.status(200).json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateFCMToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'Missing fcmToken' });
    
    await User.findByIdAndUpdate(req.user.userId, { fcmToken });
    res.status(200).json({ message: 'FCM Token updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const testPushNotification = async (req, res) => {
  try {
    const { title, body } = req.body;
    
    // Look up current user's FCM token
    const user = await User.findById(req.user.userId);
    if (!user || !user.fcmToken) {
      return res.status(400).json({ error: 'User does not have an FCM token registered' });
    }

    const payload = {
      token: user.fcmToken,
      notification: {
        title: title || 'Test Notification',
        body: body || 'This is a test push notification from your backend!'
      },
      data: {
        test: 'true'
      }
    };

    const response = await getMessaging().send(payload);
    res.status(200).json({ message: 'Push notification sent successfully!', response });
  } catch (error) {
    console.error('Test Push Error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getMe, getAllUsers, updateFCMToken, testPushNotification };
