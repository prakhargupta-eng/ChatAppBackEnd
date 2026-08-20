const express = require('express');
const { getMe, getAllUsers } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/me', requireAuth, getMe);
router.get('/', requireAuth, getAllUsers); // Helpful to get other users to chat with

module.exports = router;
