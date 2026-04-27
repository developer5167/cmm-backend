const express = require('express');
const multer = require('multer');
const { body, param } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getStatus, getHobbies,
  step1, step2, step3, step4, step5,
  step6, step7, step8, step9, step10,
  deletePhoto,
} = require('../controllers/onboarding.controller');

// ─── Multer config ────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// All onboarding routes require auth
router.use(authMiddleware);

// ─── Status & Meta ────────────────────────────────────────────
router.get('/status', getStatus);
router.get('/hobbies', getHobbies);

// ─── Step 1: Basic ───────────────────────────────────────────
router.post(
  '/step/1',
  [
    body('gender').notEmpty().isIn(['male', 'female']).withMessage('Gender must be male or female'),
    body('looking_for').notEmpty().isIn(['male', 'female']).withMessage('Looking for must be male or female'),
    body('first_name').notEmpty().isLength({ min: 2, max: 100 }).withMessage('First name must be 2–100 characters'),
    body('last_name').optional().isLength({ max: 100 }),
    body('date_of_birth')
      .notEmpty().withMessage('Date of birth is required')
      .isISO8601().withMessage('Invalid date format (use YYYY-MM-DD)')
      .custom((val) => {
        const age = (Date.now() - new Date(val)) / (1000 * 60 * 60 * 24 * 365.25);
        if (age < 18) throw new Error('Must be at least 18 years old');
        if (age > 70) throw new Error('Age must be under 70');
        return true;
      }),
    body('location_city').notEmpty().withMessage('City is required'),
    body('location_state').optional().isString(),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
  ],
  validate,
  step1
);

// ─── Step 2: Matrimony Core ───────────────────────────────────
router.post(
  '/step/2',
  [
    body('marriage_intent')
      .notEmpty()
      .isIn(['ready_now', 'within_6_months', 'within_1_year', 'within_2_years'])
      .withMessage('Invalid marriage intent'),
    body('denomination')
      .notEmpty()
      .isIn(['protestant', 'catholic', 'orthodox', 'csi', 'pentecostal', 'born_again', 'other'])
      .withMessage('Invalid denomination'),
    body('church_name').optional().isLength({ max: 200 }),
    body('faith_level')
      .optional()
      .isIn(['very_strong', 'strong', 'moderate', 'growing'])
      .withMessage('Invalid faith level'),
    body('church_involvement')
      .optional()
      .isIn(['very_active', 'active', 'occasional', 'rare'])
      .withMessage('Invalid church involvement'),
    body('caste').optional().isLength({ max: 100 }),
  ],
  validate,
  step2
);

// ─── Step 3: Personal ────────────────────────────────────────
router.post(
  '/step/3',
  [
    body('education').optional().isLength({ max: 200 }),
    body('profession').optional().isLength({ max: 200 }),
    body('annual_income_min').optional().isInt({ min: 0 }),
    body('annual_income_max').optional().isInt({ min: 0 }),
    body('height_cm').optional().isInt({ min: 100, max: 250 }),
    body('complexion').optional().isString().isLength({ max: 50 }),
    body('native_place').optional().isLength({ max: 100 }),
    body('languages_spoken').optional().isArray(),
    body('previously_married').optional().isIn(['never', 'divorced', 'widowed']),
    body('marriage_timeline')
      .optional()
      .isIn(['within_6_months', 'within_1_year', 'within_2_years', 'not_decided']),
    body('annual_income_max').optional().custom((val, { req }) => {
      if (req.body.annual_income_min && val < req.body.annual_income_min) {
        throw new Error('Max income must be greater than min income');
      }
      return true;
    }),
  ],
  validate,
  step3
);

// ─── Step 4: Lifestyle ────────────────────────────────────────
router.post(
  '/step/4',
  [
    body('smoking').optional().isIn(['yes', 'no', 'occasionally']),
    body('drinking').optional().isIn(['yes', 'no', 'occasionally']),
    body('diet').optional().isIn(['veg', 'non_veg', 'occasionally']),
    body('gym').optional().isIn(['yes', 'no', 'occasionally']),
  ],
  validate,
  step4
);

// ─── Step 5: Family ───────────────────────────────────────────
router.post(
  '/step/5',
  [
    body('father_occupation').optional().isLength({ max: 200 }),
    body('mother_occupation').optional().isLength({ max: 200 }),
    body('brothers_count').optional().isInt({ min: 0, max: 20 }),
    body('sisters_count').optional().isInt({ min: 0, max: 20 }),
    body('married_brothers_count').optional().isInt({ min: 0, max: 20 }),
    body('married_sisters_count').optional().isInt({ min: 0, max: 20 }),
    body('family_income_range').optional().isString(),
    body('family_class').optional().isIn(['middle', 'upper_middle', 'affluent']),
  ],
  validate,
  step5
);

// ─── Step 6: Partner Preferences ─────────────────────────────
router.post(
  '/step/6',
  [
    body('age_min').optional().isInt({ min: 18, max: 70 }),
    body('age_max').optional().isInt({ min: 18, max: 70 }),
    body('age_max').optional().custom((val, { req }) => {
      if (req.body.age_min && val < req.body.age_min) {
        throw new Error('Max age must be ≥ min age');
      }
      return true;
    }),
    body('location_flexible').optional().isBoolean(),
    body('preferred_locations').optional().isArray(),
    body('denomination_flexible').optional().isBoolean(),
    body('preferred_denominations').optional().isArray(),
    body('caste_flexible').optional().isBoolean(),
    body('preferred_castes').optional().isArray(),
    body('education_preference').optional().isString(),
    body('profession_preference').optional().isString(),
    body('salary_min').optional().isInt({ min: 0 }),
    body('salary_max').optional().isInt({ min: 0 }),
  ],
  validate,
  step6
);

// ─── Step 7: Hobbies ─────────────────────────────────────────
router.post(
  '/step/7',
  [
    body('hobby_ids')
      .notEmpty().withMessage('hobby_ids is required')
      .isArray({ min: 1, max: 10 }).withMessage('Select 1–10 hobbies'),
    body('hobby_ids.*').isInt({ min: 1 }).withMessage('Each hobby ID must be a positive integer'),
  ],
  validate,
  step7
);

// ─── Step 8: Photos ───────────────────────────────────────────
router.post(
  '/step/8',
  upload.array('photos', 6),
  step8
);

router.delete(
  '/photos/:photoId',
  [param('photoId').isUUID().withMessage('Invalid photo ID')],
  validate,
  deletePhoto
);

// ─── Step 9: Verification ────────────────────────────────────
router.post(
  '/step/9',
  upload.single('govt_id'),
  [
    body('govt_id_type')
      .optional()
      .isIn(['aadhaar', 'pan', 'passport', 'driving_license', 'voter_id'])
      .withMessage('Invalid ID type'),
  ],
  validate,
  step9
);

// ─── Step 10: Profile Managed By + Finalize ──────────────────
router.post(
  '/step/10',
  [
    body('profile_managed_by')
      .notEmpty().withMessage('profile_managed_by is required')
      .isIn(['self', 'parents', 'others']).withMessage('Must be self, parents, or others'),
  ],
  validate,
  step10
);

module.exports = router;
