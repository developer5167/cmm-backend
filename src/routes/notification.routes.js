const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const {
  getNotifications,
  markAllRead,
  markOneRead,
  getUnreadCount,
} = require('../controllers/notification.controller');

router.use(authMiddleware);

router.get('/',           getNotifications); // GET  /api/v1/notifications
router.get('/unread',     getUnreadCount);   // GET  /api/v1/notifications/unread
router.put('/read-all',   markAllRead);      // PUT  /api/v1/notifications/read-all
router.put('/:id/read',   markOneRead);      // PUT  /api/v1/notifications/:id/read

module.exports = router;
