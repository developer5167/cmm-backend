const express = require('express');
const multer = require('multer');
const { body } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getStories,
  submitStory,
  getMatchAnalytics,
  sendBatchNotification,
} = require('../controllers/growth.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// Public can view success stories
router.get('/success-stories', getStories);

router.use(authMiddleware);

// Only authenticated can submit success stories and view analytics
router.post(
  '/success-stories',
  upload.single('photo'),
  [
    body('partner1_name').notEmpty().withMessage('Partner 1 name required'),
    body('partner2_name').notEmpty().withMessage('Partner 2 name required'),
    body('story_text').notEmpty().withMessage('Story narrative required'),
  ],
  validate,
  submitStory
);

router.get('/analytics', getMatchAnalytics);

const { adminAuthMiddleware } = require('../middleware/auth.middleware');

router.post('/batch-notify', adminAuthMiddleware, sendBatchNotification);

module.exports = router;
