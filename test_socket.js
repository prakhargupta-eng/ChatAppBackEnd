const { io } = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected', socket.id);
  socket.emit('register', '12345');
});

socket.on('registered', (data) => {
  console.log('Registered response:', data);
  socket.disconnect();
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('Connection Error:', err);
  process.exit(1);
});
