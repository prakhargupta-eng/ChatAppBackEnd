const express = require('express');
const { loginOrRegister, logout } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', loginOrRegister);
router.post('/logout', logout);

module.exports = router;
