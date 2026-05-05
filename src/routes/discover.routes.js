const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middleware/auth.middleware');
const { getDiscoverFeed, getDailyMatches } = require('../controllers/discover.controller');

router.use(authMiddleware);

router.get('/feed',          getDiscoverFeed);
router.get('/daily-matches', getDailyMatches);

module.exports = router;
