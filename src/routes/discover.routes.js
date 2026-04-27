const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middleware/auth.middleware');
const { getDiscoverFeed } = require('../controllers/discover.controller');

router.use(authMiddleware);

/**
 * @route   GET /api/v1/discover/feed
 * @desc    Get swipeable profiles feed (enforces daily limit + compat score)
 * @access  Private
 */
router.get('/feed', getDiscoverFeed);

module.exports = router;
