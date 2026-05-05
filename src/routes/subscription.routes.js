const express = require('express');
const { body } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getPlans,
  createRazorpayOrder,
  razorpayWebhook,
  verifyRazorpayPayment,
  verifyIosSubscription,
} = require('../controllers/subscription.controller');

// ─── PUBLIC ───────────────────────────────────────────────────
// Razorpay webhook is called by Razorpay backend, no our auth
router.post(
  '/razorpay/webhook',
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
  razorpayWebhook
);

// ─── PRIVATE ──────────────────────────────────────────────────
router.use(authMiddleware);

router.get('/plans', getPlans);

router.post(
  '/razorpay/order',
  [body('plan_id').isUUID().withMessage('Valid plan ID required')],
  validate,
  createRazorpayOrder
);

router.post('/razorpay/verify', verifyRazorpayPayment);

router.post(
  '/ios/verify',
  [
    body('plan_id').isUUID().withMessage('Valid plan ID required'),
    body('receipt_data').notEmpty().withMessage('Receipt data required'),
  ],
  validate,
  verifyIosSubscription
);

module.exports = router;
