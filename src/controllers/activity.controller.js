const { query } = require('../db');

// ─── HELPER: check premium feature ───────────────────────────
const hasPremiumFeature = async (userId, featureKey) => {
  const result = await query(
    `SELECT p.features FROM subscriptions s
     JOIN subscription_plans p ON s.plan_id = p.id
     WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > NOW()`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  return !!result.rows[0].features[featureKey];
};

// ─── GET Activity Summary (badge counts) ─────────────────────
const getSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [notifRes, viewRes, shortlistRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`, [userId]),
      query(`SELECT COUNT(*) FROM profile_views WHERE viewed_id = $1 AND viewed_at > NOW() - INTERVAL '7 days'`, [userId]),
      query(`SELECT COUNT(*) FROM shortlists WHERE shortlisted_user_id = $1`, [userId]),
    ]);

    res.json({
      success: true,
      data: {
        unread_notifications: parseInt(notifRes.rows[0].count),
        views_last_7d: parseInt(viewRes.rows[0].count),
        shortlisted_by: parseInt(shortlistRes.rows[0].count),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET Who Viewed Me ────────────────────────────────────────
// Premium-gated: requires `see_who_viewed` feature
const getViews = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const isPremium = await hasPremiumFeature(userId, 'see_who_viewed');

    // Always return recent view count; only return identities for premium
    const countRes = await query(
      `SELECT COUNT(DISTINCT viewer_id) FROM profile_views WHERE viewed_id = $1`,
      [userId]
    );
    const totalViews = parseInt(countRes.rows[0].count);

    if (!isPremium) {
      return res.json({
        success: true,
        data: {
          is_premium_required: true,
          total_views: totalViews,
          viewers: [],
        },
      });
    }

    // Return actual viewer identities (deduplicated — most recent view per viewer)
    const viewsRes = await query(
      `SELECT DISTINCT ON (pv.viewer_id)
         pv.viewer_id as user_id,
         p.first_name, p.location_city, p.denomination,
         p.date_of_birth,
         p.trust_badge,
         pv.viewed_at,
         (SELECT photo_url FROM user_photos
          WHERE user_id = pv.viewer_id AND is_approved = true AND is_primary = true
          LIMIT 1) as photo_url
       FROM profile_views pv
       JOIN user_profiles p ON p.user_id = pv.viewer_id
       JOIN users u ON u.id = pv.viewer_id
       WHERE pv.viewed_id = $1
         AND u.is_active = true
         AND u.is_suspended = false
       ORDER BY pv.viewer_id, pv.viewed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Compute age
    const viewers = viewsRes.rows.map(v => {
      const dob = v.date_of_birth ? new Date(v.date_of_birth) : null;
      const age = dob ? new Date().getFullYear() - dob.getFullYear() : null;
      return { ...v, age, date_of_birth: undefined };
    });

    res.json({
      success: true,
      data: {
        is_premium_required: false,
        total_views: totalViews,
        viewers,
        page,
        has_more: viewsRes.rows.length === limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET My Shortlists ────────────────────────────────────────
const getShortlists = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT
         p.user_id, p.first_name, p.location_city, p.denomination,
         p.date_of_birth, p.profession, p.trust_badge,
         s.created_at as shortlisted_at,
         (SELECT photo_url FROM user_photos
          WHERE user_id = p.user_id AND is_approved = true AND is_primary = true
          LIMIT 1) as photo_url
       FROM shortlists s
       JOIN user_profiles p ON p.user_id = s.shortlisted_user_id
       JOIN users u ON u.id = s.shortlisted_user_id
       WHERE s.user_id = $1
         AND u.is_active = true
         AND u.is_suspended = false
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const profiles = result.rows.map(v => {
      const dob = v.date_of_birth ? new Date(v.date_of_birth) : null;
      const age = dob ? new Date().getFullYear() - dob.getFullYear() : null;
      return { ...v, age, date_of_birth: undefined };
    });

    res.json({
      success: true,
      data: { profiles, page, has_more: result.rows.length === limit },
    });
  } catch (err) {
    next(err);
  }
};

// ─── TOGGLE Shortlist ─────────────────────────────────────────
const toggleShortlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { target_user_id } = req.body;

    if (!target_user_id) {
      return res.status(400).json({ success: false, message: 'target_user_id is required' });
    }
    if (userId === target_user_id) {
      return res.status(400).json({ success: false, message: 'Cannot shortlist yourself' });
    }

    // Check if already shortlisted
    const existing = await query(
      `SELECT 1 FROM shortlists WHERE user_id = $1 AND shortlisted_user_id = $2`,
      [userId, target_user_id]
    );

    if (existing.rows.length > 0) {
      // Remove
      await query(
        `DELETE FROM shortlists WHERE user_id = $1 AND shortlisted_user_id = $2`,
        [userId, target_user_id]
      );
      return res.json({ success: true, message: 'Removed from shortlist', data: { is_shortlisted: false } });
    }

    // Add
    await query(
      `INSERT INTO shortlists (user_id, shortlisted_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, target_user_id]
    );

    // Notify the shortlisted person
    const senderProfile = await query(
      `SELECT first_name FROM user_profiles WHERE user_id = $1`, [userId]
    );
    const fname = senderProfile.rows[0]?.first_name || 'Someone';

    await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, 'shortlisted', $2, $3, $4)`,
      [
        target_user_id,
        'You have been shortlisted! ⭐',
        `${fname} added you to their shortlist.`,
        JSON.stringify({ actor_id: userId }),
      ]
    );

    res.json({ success: true, message: 'Added to shortlist', data: { is_shortlisted: true } });
  } catch (err) {
    next(err);
  }
};

// ─── CHECK Shortlist status for a profile ────────────────────
const checkShortlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { target_user_id } = req.query;
    const result = await query(
      `SELECT 1 FROM shortlists WHERE user_id = $1 AND shortlisted_user_id = $2`,
      [userId, target_user_id]
    );
    res.json({ success: true, data: { is_shortlisted: result.rows.length > 0 } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSummary, getViews, getShortlists, toggleShortlist, checkShortlist };
