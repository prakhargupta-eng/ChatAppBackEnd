const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

// Helper to generate token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Dummy register/login for testing purposes
const loginOrRegister = async (req, res) => {
  const { username, password, fcmToken } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    if (fcmToken) {
      // Remove this token from any other user to ensure uniqueness
      await User.updateMany(
        { fcmToken },
        { $unset: { fcmToken: "" } }
      );
    }

    let user = await User.findOne({ username });
    if (!user) {
      // Create user if not exists (dummy logic)
      user = new User({ username, password, fcmToken }); // Password should be hashed in a real app!
      await user.save();
    } else if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    } else if (fcmToken) {
      // Update existing user with new fcmToken if provided
      user.fcmToken = fcmToken;
      await user.save();
    }

    const token = generateToken(user._id);
    res.cookie('jwt', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(200).json({ message: 'Success', user: { _id: user._id, username: user.username }, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const logout = async (req, res) => {
  try {
    // Attempt to read the token and clear the user's FCM token from DB
    const token = req.cookies.jwt;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.userId) {
        await User.findByIdAndUpdate(decoded.userId, { $unset: { fcmToken: "" } });
      }
    }
  } catch (error) {
    console.error('Error clearing FCM token during logout:', error.message);
  }

  res.cookie('jwt', '', { maxAge: 1 });
  res.status(200).json({ message: 'Logged out successfully' });
};

module.exports = { loginOrRegister, logout };
