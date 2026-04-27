const { query } = require('../db');
const { uploadFile } = require('../services/storage.service');

// ─── GET Published Success Stories ────────────────────────────
const getStories = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT id, partner1_name, partner2_name, story_text, photo_url, engagement_date, marriage_date
       FROM success_stories
       WHERE is_published = true
       ORDER BY marriage_date DESC NULLS LAST, created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── SUBMIT Success Story ─────────────────────────────────────
const submitStory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { partner1_name, partner2_name, story_text, engagement_date, marriage_date } = req.body;
    const file = req.file;

    // Check if user already submitted a story
    const existing = await query(`SELECT id FROM success_stories WHERE submitter_id = $1`, [userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'You have already submitted a success story.' });
    }

    let photoUrl = null;
    if (file) {
      const uploadRes = await uploadFile(file, 'success-stories');
      photoUrl = uploadRes.url;
    }

    const fields = Object.fromEntries(
      Object.entries({
        submitter_id: userId,
        partner1_name, partner2_name, story_text, photo_url: photoUrl,
        engagement_date, marriage_date
      }).filter(([, v]) => v !== undefined)
    );

    const keys = Object.keys(fields);
    const result = await query(
      `INSERT INTO success_stories (${keys.join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      Object.values(fields)
    );

    res.json({ success: true, message: 'Success story submitted for review.', data: { story_id: result.rows[0].id } });
  } catch (err) {
    next(err);
  }
};

// ─── GET Match Analytics for the signed-in user ────────────────
const getMatchAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [views, receivedInterest, sentInterest, unreadMsg] = await Promise.all([
      query(`SELECT COUNT(*) FROM profile_views WHERE viewed_id = $1 AND created_at > NOW() - INTERVAL '7 days'`, [userId]),
      query(`SELECT COUNT(*) FROM interests WHERE receiver_id = $1 AND status = 'sent'`, [userId]),
      query(`SELECT COUNT(*) FROM interests WHERE sender_id = $1`, [userId]),
      query(`SELECT COUNT(*) FROM messages WHERE sender_id != $1 AND is_read = false AND conversation_id IN (SELECT id FROM conversations WHERE user1_id = $1 OR user2_id = $1)`, [userId]),
    ]);

    res.json({
      success: true,
      data: {
        profile_views_7_days: parseInt(views.rows[0].count),
        pending_interests_received: parseInt(receivedInterest.rows[0].count),
        total_interests_sent: parseInt(sentInterest.rows[0].count),
        unread_messages: parseInt(unreadMsg.rows[0].count),
      }
    });

  } catch (err) {
    next(err);
  }
};

// ─── BATCH Notification API (Admin only logically, but fits here for growth engagement)
const { sendPushToUser } = require('../services/fcm.service');

const sendBatchNotification = async (req, res, next) => {
  try {
    const { title, body, denomination, location_city } = req.body;

    let sql = `SELECT user_id FROM user_profiles WHERE 1=1 `;
    const params = [];
    if (denomination) {
      params.push(denomination);
      sql += ` AND denomination = $${params.length}`;
    }
    if (location_city) {
      params.push(location_city);
      sql += ` AND location_city = $${params.length}`;
    }

    const targets = await query(sql, params);
    
    // Async send (fire and forget)
    targets.rows.forEach(u => {
      sendPushToUser(u.user_id, { title, body }, { type: 'batch_announcement' })
        .catch(console.error);
    });

    res.json({ success: true, message: `Batch notification queued for ${targets.rows.length} users.` });
  } catch(err) {
    next(err);
  }
};

module.exports = {
  getStories,
  submitStory,
  getMatchAnalytics,
  sendBatchNotification,
};
