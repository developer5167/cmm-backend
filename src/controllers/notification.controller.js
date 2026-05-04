const { query } = require('../db');

// ─── GET Notifications ────────────────────────────────────────
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;

    const [listRes, unreadRes] = await Promise.all([
      query(
        `SELECT id, type, title, body, data, is_read, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
      query(
        `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
        [userId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        notifications: listRes.rows,
        unread_count: parseInt(unreadRes.rows[0].count),
        page,
        has_more: listRes.rows.length === limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── MARK All Read ────────────────────────────────────────────
const markAllRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
};

// ─── MARK Single Read ─────────────────────────────────────────
const markOneRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id }  = req.params;
    await query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ─── Unread Count only (for badge) ────────────────────────────
const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ success: true, data: { unread_count: parseInt(result.rows[0].count) } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getNotifications, markAllRead, markOneRead, getUnreadCount };
