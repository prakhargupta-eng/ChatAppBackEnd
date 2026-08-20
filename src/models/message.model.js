const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true
  },
  conversationId: {
    type: String,
    required: true,
    index: true // Index for faster queries when fetching history
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderName: {
    type: String
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiverName: {
    type: String
  },
  text: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'text',
    enum: ['text', 'audio', 'video', 'none']
  },
  status: {
    type: String,
    default: 'sent',
    enum: ['sent', 'delivered', 'read']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Message', messageSchema);
