const express = require('express');
const { body, param } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getMyProfile,
  updateProfile,
  updateFamily,
  updatePreferences,
  updateSettings,
  getPublicProfile,
} = require('../controllers/profile.controller');

// All profile routes require auth
router.use(authMiddleware);

// ─── GET My Profile ──────────────────────────────────────────
router.get('/me', getMyProfile);

// ─── UPDATE Basic Profile ─────────────────────────────────────
router.put(
  '/me',
  [
    body('first_name').optional().isLength({ min: 2, max: 100 }),
    body('last_name').optional().isLength({ max: 100 }),
    body('location_city').optional().isString(),
    body('profession').optional().isString(),
    body('education').optional().isString(),
    body('height_cm').optional().isInt({ min: 100, max: 250 }),
    // can add more basic validation as needed
  ],
  validate,
  updateProfile
);

// ─── UPDATE Family ────────────────────────────────────────────
router.put(
  '/family',
  [
    body('father_occupation').optional().isString(),
    body('brothers_count').optional().isInt({ min: 0 }),
    // can add more
  ],
  validate,
  updateFamily
);

// ─── UPDATE Partner Preferences ───────────────────────────────
router.put(
  '/preferences',
  [
    body('age_min').optional().isInt({ min: 18 }),
    body('age_max').optional().isInt({ max: 70 }),
  ],
  validate,
  updatePreferences
);

// ─── UPDATE Settings/Privacy ──────────────────────────────────
router.put(
  '/settings',
  [
    body('profile_visibility').optional().isIn(['everyone', 'interests_only', 'hidden']),
    body('who_can_chat').optional().isIn(['everyone', 'interests_only']),
    body('is_contact_sharing_allowed').optional().isBoolean(),
    body('is_images_locked').optional().isBoolean(),
  ],
  validate,
  updateSettings
);

// ─── GET Public Profile ───────────────────────────────────────
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid profile ID format')],
  validate,
  getPublicProfile
);

module.exports = router;
