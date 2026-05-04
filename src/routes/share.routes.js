const express = require('express');
const router  = express.Router();
const { getPublicProfile, assetLinks, appleAppSiteAssociation } = require('../controllers/share.controller');

// Public profile — no auth, safe fields only
router.get('/profile/:userId', getPublicProfile);

module.exports = router;
