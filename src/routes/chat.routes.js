const express = require('express');
const { getChatHistory, getUndeliveredMessages } = require('../controllers/chat.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all undelivered messages for a specific user
router.get('/undelivered/:userId', requireAuth, getUndeliveredMessages);

// Get chat history for a specific conversation
router.get('/:conversationId', requireAuth, getChatHistory);

module.exports = router;
