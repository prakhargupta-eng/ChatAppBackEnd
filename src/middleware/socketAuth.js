const jwt = require('jsonwebtoken');

const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    const err = new Error("not authorized");
    err.data = { content: "Please provide a valid token" };
    return next(err);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Standardize across the socket as socket.userId per spec
    socket.userId = decoded.userId || decoded.id || decoded._id;
    if (!socket.userId) {
      return next(new Error("Token payload invalid, no userId found"));
    }
    next();
  } catch (err) {
    next(new Error("not authorized"));
  }
};

module.exports = { socketAuthMiddleware };
