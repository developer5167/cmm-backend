const { query } = require('../db');

// ─── GET Users ────────────────────────────────────────────────
const getUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const sql = `
      SELECT u.id, u.phone_number, u.is_active, u.is_suspended, u.created_at,
             p.first_name, p.gender, p.profile_completion_score, p.trust_badge
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await query(sql, [limit, offset]);
    
    res.json({ success: true, data: result.rows });
  } catch(err) {
    next(err);
  }
};

// ─── SUSPEND / UNSUSPEND User ─────────────────────────────────
const suspendUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_suspended } = req.body;

    await query(`UPDATE users SET is_suspended = $1, updated_at = NOW() WHERE id = $2`, [is_suspended, id]);
    
    // Also log out user if suspended (could delete refresh tokens, FCM tokens etc)
    if (is_suspended) {
      await query(`DELETE FROM fcm_tokens WHERE user_id = $1`, [id]);
    }

    res.json({ success: true, message: `User ${is_suspended ? 'suspended' : 'unsuspended'} successfully` });
  } catch(err) {
    next(err);
  }
};

// ─── GET Verifications Queue ──────────────────────────────────
const getVerifications = async (req, res, next) => {
  try {
    // pending implies that an id or video is submitted but not verified
    const result = await query(`
      SELECT v.user_id, v.govt_id_url, v.govt_id_type, v.video_selfie_url, v.is_id_verified, v.is_selfie_verified, v.created_at,
             p.first_name
      FROM user_verification v
      JOIN user_profiles p ON v.user_id = p.user_id
      WHERE (v.govt_id_url IS NOT NULL AND v.is_id_verified = false) 
         OR (v.video_selfie_url IS NOT NULL AND v.is_selfie_verified = false)
      ORDER BY v.created_at ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch(err) {
    next(err);
  }
};

// ─── APPROVE Verification ─────────────────────────────────────
const approveVerification = async (req, res, next) => {
  try {
    const { id } = req.params; // this is user_id of the person being verified
    const { type } = req.body; // 'id' or 'selfie'

    if (type === 'id') {
      await query(`UPDATE user_verification SET is_id_verified = true, updated_at = NOW() WHERE user_id = $1`, [id]);
    } else if (type === 'selfie') {
      await query(`UPDATE user_verification SET is_selfie_verified = true, updated_at = NOW() WHERE user_id = $1`, [id]);
    } else {
      return res.status(400).json({ success: false, message: 'Type must be id or selfie' });
    }

    // Attempt to recalculate completion score & assign trust badge
    // trust badge requires: ID verified + church_name + denomination
    const profRes = await query(`SELECT church_name, denomination FROM user_profiles WHERE user_id = $1`, [id]);
    const verRes = await query(`SELECT is_id_verified FROM user_verification WHERE user_id = $1`, [id]);

    if (profRes.rows.length > 0 && verRes.rows.length > 0) {
      const p = profRes.rows[0];
      const v = verRes.rows[0];
      const trustBadge = !!(v.is_id_verified && p.church_name && p.denomination);
      await query(`UPDATE user_profiles SET trust_badge = $1 WHERE user_id = $2`, [trustBadge, id]);
    }

    res.json({ success: true, message: `Verification of ${type} approved.` });
  } catch(err) {
    next(err);
  }
};

// ─── GET Reports Queue ────────────────────────────────────────
const getReportsQueue = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT r.id, r.reporter_id, r.reported_id, r.reason, r.details, r.status, r.created_at,
             p1.first_name as reporter_name, p2.first_name as reported_name
      FROM reports r
      JOIN user_profiles p1 ON r.reporter_id = p1.user_id
      JOIN user_profiles p2 ON r.reported_id = p2.user_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC
    `);
    
    res.json({ success: true, data: result.rows });
  } catch(err) {
    next(err);
  }
};

const resolveReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body; // 'dismissed' or 'action_taken'

    await query(`UPDATE reports SET status = 'resolved', resolution_notes = $1 WHERE id = $2`, [resolution, id]);
    
    res.json({ success: true, message: 'Report resolved' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUsers,
  suspendUser,
  getVerifications,
  approveVerification,
  getReportsQueue,
  resolveReport,
};
