const express = require('express');
const { body, param, query } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  sendInterest,
  acceptInterest,
  rejectInterest,
  getInterestsList,
} = require('../controllers/interest.controller');

router.use(authMiddleware);

// ─── SEND Interest ──────────────────────────────────────────
router.post(
  '/',
  [
    body('receiver_id').isUUID().withMessage('Invalid receiver ID'),
    body('is_super_interest').optional().isBoolean(),
  ],
  validate,
  sendInterest
);

// ─── ACCEPT Interest ────────────────────────────────────────
router.post(
  '/:id/accept',
  [param('id').isUUID().withMessage('Invalid interest ID')],
  validate,
  acceptInterest
);

// ─── REJECT Interest ────────────────────────────────────────
router.post(
  '/:id/reject',
  [param('id').isUUID().withMessage('Invalid interest ID')],
  validate,
  rejectInterest
);

// ─── GET Lists (received, sent, connected) ──────────────────
router.get(
  '/list',
  [
    query('type')
      .optional()
      .isIn(['received', 'sent', 'connected'])
      .withMessage('Type must be received, sent, or connected'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  getInterestsList
);

module.exports = router;
