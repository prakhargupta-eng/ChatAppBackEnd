const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');

const app = express();

app.use(cors({
  origin: '*', // Adjust for production
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public')); // For testing client

// Console log every incoming request
app.use((req, res, next) => {
  console.log(`[API REQUEST] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) console.log('  Body:', req.body);
  if (req.query && Object.keys(req.query).length > 0) console.log('  Query:', req.query);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', require('./routes/chat.routes'));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

module.exports = app;
