const express = require('express');
const { body, query: qv } = require('express-validator');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getSummary,
  getViews,
  getShortlists,
  toggleShortlist,
  checkShortlist,
  getBootstrap,
} = require('../controllers/activity.controller');

router.use(authMiddleware);

// Bootstrap — single call for the entire Activity tab
router.get('/bootstrap', getBootstrap);

// Summary (badge counts)
router.get('/summary', getSummary);

// Who viewed me (premium gated)
router.get('/views', getViews);

// Shortlist
router.get('/shortlists', getShortlists);
router.get('/shortlists/check',
  [qv('target_user_id').isUUID().withMessage('target_user_id must be a UUID')],
  validate,
  checkShortlist
);
router.post('/shortlists',
  [body('target_user_id').isUUID().withMessage('target_user_id must be a UUID')],
  validate,
  toggleShortlist
);

module.exports = router;
