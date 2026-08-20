const express = require('express');
const { getChatHistory } = require('../controllers/chat.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Get chat history for a specific conversation
router.get('/:conversationId', requireAuth, getChatHistory);

module.exports = router;
