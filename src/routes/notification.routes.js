const express = require('express');
const router = express.Router();

// TODO: implement notification routes
router.get('/', (req, res) => res.json({ success: true, message: 'notification routes — coming soon' }));

module.exports = router;
