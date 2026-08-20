const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

// Helper to generate token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Dummy register/login for testing purposes
const loginOrRegister = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    let user = await User.findOne({ username });
    if (!user) {
      // Create user if not exists (dummy logic)
      user = new User({ username, password }); // Password should be hashed in a real app!
      await user.save();
    } else if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = generateToken(user._id);
    res.cookie('jwt', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(200).json({ message: 'Success', user: { _id: user._id, username: user.username }, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const logout = (req, res) => {
  res.cookie('jwt', '', { maxAge: 1 });
  res.status(200).json({ message: 'Logged out successfully' });
};

module.exports = { loginOrRegister, logout };
