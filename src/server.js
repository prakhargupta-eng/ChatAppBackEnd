const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const app = require('./app');
const initChatSocket = require('./sockets/chat.socket');
const { initFirebase } = require('./config/firebase');

dotenv.config();

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp';

// Initialize Firebase Admin SDK
initFirebase();

const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000, // Check connection every 10 seconds (default is 25s)
  pingTimeout: 5000,   // Disconnect if no response for 5 seconds (default is 20s)
});

initChatSocket(io);

// Connect to MongoDB and start server
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
