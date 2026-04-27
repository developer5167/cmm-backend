const express = require('express');
const { body, param } = require('express-validator');

const router = express.Router();
const { authMiddleware, adminAuthMiddleware, superAdminOnly } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getUsers,
  suspendUser,
  getVerifications,
  approveVerification,
  getReportsQueue,
  resolveReport,
} = require('../controllers/admin.controller');

// All admin routes require standard API auth, PLUS verify admin token
router.use(authMiddleware);
router.use(adminAuthMiddleware);

// ─── Users ───────────────────────────────────────────────────
router.get('/users', getUsers);

router.post(
  '/users/:id/suspend',
  [
    param('id').isUUID().withMessage('Invalid User ID'),
    body('is_suspended').isBoolean().withMessage('Required boolean is_suspended'),
  ],
  validate,
  superAdminOnly, // Only super_admin role can suspend users
  suspendUser
);

// ─── Verifications ────────────────────────────────────────────
router.get('/verifications', getVerifications);

router.post(
  '/verifications/:id/approve',
  [
    param('id').isUUID().withMessage('Invalid User ID'),
    body('type').isIn(['id', 'selfie']).withMessage('Type must be id or selfie'),
  ],
  validate,
  approveVerification
);

// ─── Reports ──────────────────────────────────────────────────
router.get('/reports', getReportsQueue);

router.post(
  '/reports/:id/resolve',
  [
    param('id').isInt().withMessage('Invalid Report ID'),
    body('resolution').isString().withMessage('Required resolution details'),
  ],
  validate,
  resolveReport
);

module.exports = router;
