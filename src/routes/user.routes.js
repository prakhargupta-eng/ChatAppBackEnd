const express = require('express');
const { getMe, getAllUsers, updateFCMToken } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/me', requireAuth, getMe);
router.get('/', requireAuth, getAllUsers); // Helpful to get other users to chat with
router.put('/fcm-token', requireAuth, updateFCMToken);

module.exports = router;
