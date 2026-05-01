const express = require('express');
const multer = require('multer');
const { body, param } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getMatchExplanation,
  uploadVideoSelfie,
  reportProfile,
  blockProfile,
  verifyIdentity,
} = require('../controllers/trust.controller');

// ─── Multer config for video ──────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max for short video
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  },
});

// ─── Multer config for ID Proof (Image) ──────────────────────
const imageUpload = multer({
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

router.use(authMiddleware);

// ─── AI Match Explanation ─────────────────────────────────────
router.get(
  '/explanation/:id',
  [param('id').isUUID().withMessage('Invalid profile ID')],
  validate,
  getMatchExplanation
);

// ─── Upload Video Selfie ──────────────────────────────────────
router.post(
  '/video-selfie',
  upload.single('video'),
  uploadVideoSelfie
);

// ─── Verify Identity (ID Proof) ───────────────────────────────
router.post(
  '/verify-identity',
  imageUpload.single('id_proof'),
  verifyIdentity
);

// ─── Report Profile ───────────────────────────────────────────
router.post(
  '/report',
  [
    body('reported_user_id').isUUID().withMessage('Invalid user ID'),
    body('reason').notEmpty().withMessage('Reason is required'),
    body('details').optional().isString(),
  ],
  validate,
  reportProfile
);

// ─── Block Profile ────────────────────────────────────────────
router.post(
  '/block',
  [body('blocked_user_id').isUUID().withMessage('Invalid user ID')],
  validate,
  blockProfile
);

module.exports = router;
