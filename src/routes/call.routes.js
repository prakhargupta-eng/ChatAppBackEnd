const express = require('express');
const { getCallHistory, getCallDetails, deleteCallHistory } = require('../controllers/call.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, getCallHistory);
router.get('/:callId', requireAuth, getCallDetails);
router.delete('/:callId', requireAuth, deleteCallHistory);

module.exports = router;
