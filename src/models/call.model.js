const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  callerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  callType: {
    type: String,
    enum: ["audio", "video"],
    required: true
  },
  status: {
    type: String,
    enum: [
      "ringing",
      "accepted",
      "connected",
      "rejected",
      "missed",
      "busy",
      "cancelled",
      "ended",
      "failed"
    ],
    default: "ringing"
  },
  startedAt: {
    type: Date
  },
  answeredAt: {
    type: Date
  },
  endedAt: {
    type: Date
  },
  duration: {
    type: Number, // duration in milliseconds
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Call', callSchema);
