const express = require('express');
const multer = require('multer');
const { body, param, query } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  getConversationsList,
  sendMessage,
  getMessages,
} = require('../controllers/chat.controller');

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

router.use(authMiddleware);

// ─── GET Conversations List ───────────────────────────────────
router.get(
  '/conversations',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  getConversationsList
);

// ─── GET Messages (History) ───────────────────────────────────
router.get(
  '/:conversationId/messages',
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  getMessages
);

// ─── SEND Message ─────────────────────────────────────────────
router.post(
  '/:conversationId/messages',
  upload.single('photo'),
  [
    param('conversationId').isUUID().withMessage('Invalid conversation ID'),
    body('message_type').optional().isIn(['text', 'photo']).withMessage('Message type must be text or photo'),
    body('content').optional().isString(),
  ],
  validate,
  sendMessage
);

module.exports = router;
