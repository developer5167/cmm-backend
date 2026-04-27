const express = require('express');
const { body, param } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  buySpotlight,
  requestContact,
  respondContact,
} = require('../controllers/premium.controller');

router.use(authMiddleware);

// ─── BUY Spotlight ───────────────────────────────────────────
router.post('/spotlight', buySpotlight);

// ─── REQUEST Contact Reveal ──────────────────────────────────
router.post(
  '/contact-request',
  [body('target_user_id').isUUID().withMessage('Invalid target user ID')],
  validate,
  requestContact
);

// ─── RESPOND Contact Reveal ──────────────────────────────────
router.post(
  '/contact-request/:id/respond',
  [
    param('id').isUUID().withMessage('Invalid request ID'),
    body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject')
  ],
  validate,
  respondContact
);

module.exports = router;
