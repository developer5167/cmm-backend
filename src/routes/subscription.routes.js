const express = require('express');
const { body } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getPlans,
  createRazorpayOrder,
  razorpayWebhook,
  verifyIosSubscription,
} = require('../controllers/subscription.controller');

// ─── PUBLIC ───────────────────────────────────────────────────
router.get('/plans', getPlans);

// Razorpay webhook is called by Razorpay backend, no our auth
router.post('/razorpay/webhook', razorpayWebhook);

// ─── PRIVATE ──────────────────────────────────────────────────
router.use(authMiddleware);

router.post(
  '/razorpay/order',
  [body('plan_id').isInt().withMessage('Valid plan ID required')],
  validate,
  createRazorpayOrder
);

router.post(
  '/ios/verify',
  [
    body('plan_id').isInt().withMessage('Valid plan ID required'),
    body('receipt_data').notEmpty().withMessage('Receipt data required'),
  ],
  validate,
  verifyIosSubscription
);

module.exports = router;
