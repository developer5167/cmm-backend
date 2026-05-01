const { query } = require('../db');
const { uploadFile } = require('../services/storage.service');
const { generateMatchExplanation } = require('../services/ai.service');

// ─── GET Match Explanation ───────────────────────────────────
const getMatchExplanation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const targetUserId = req.params.id;

    const [myProfRes, theirProfRes] = await Promise.all([
      query(`SELECT first_name, date_of_birth, profession, denomination FROM user_profiles WHERE user_id = $1`, [userId]),
      query(`SELECT first_name, date_of_birth, profession, denomination FROM user_profiles WHERE user_id = $1`, [targetUserId]),
    ]);

    if (myProfRes.rows.length === 0 || theirProfRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const me = myProfRes.rows[0];
    const them = theirProfRes.rows[0];

    // rough age calc
    me.age = new Date().getFullYear() - new Date(me.date_of_birth).getFullYear();
    them.age = new Date().getFullYear() - new Date(them.date_of_birth).getFullYear();

    const explanation = await generateMatchExplanation(me, them);
    res.json({ success: true, data: { explanation } });
  } catch(err) {
    next(err);
  }
};

// ─── UPLOAD Video Selfie ──────────────────────────────────────
const uploadVideoSelfie = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'Video file required' });
    }

    const uploadRes = await uploadFile(file, 'video-selfies');
    
    await query(
      `INSERT INTO user_verification (user_id, video_selfie_url, video_selfie_s3_key) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id) DO UPDATE SET video_selfie_url = $2, video_selfie_s3_key = $3, updated_at = NOW()`,
      [userId, uploadRes.url, uploadRes.s3Key]
    );

    res.json({ success: true, message: 'Video selfie uploaded successfully for admin review' });
  } catch (err) {
    next(err);
  }
};

// ─── REPORT Profile ───────────────────────────────────────────
const reportProfile = async (req, res, next) => {
  try {
    const reporterId = req.user.id;
    const { reported_user_id, reason, details } = req.body;

    if (reporterId === reported_user_id) {
      return res.status(400).json({ success: false, message: 'Cannot report yourself' });
    }

    await query(
      `INSERT INTO reports (reporter_id, reported_id, reason, details, status) VALUES ($1, $2, $3, $4, 'pending')`,
      [reporterId, reported_user_id, reason, details]
    );

    res.json({ success: true, message: 'Profile reported to admins.' });
  } catch (err) {
    next(err);
  }
};

// ─── BLOCK Profile ────────────────────────────────────────────
const blockProfile = async (req, res, next) => {
  try {
    const blockerId = req.user.id;
    const { blocked_user_id } = req.body;

    if (blockerId === blocked_user_id) {
      return res.status(400).json({ success: false, message: 'Cannot block yourself' });
    }

    await query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [blockerId, blocked_user_id]
    );

    // Also remove from interests if exists
    await query(
      `DELETE FROM interests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [blockerId, blocked_user_id]
    );

    res.json({ success: true, message: 'Profile blocked successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── VERIFY Identity (Govt ID) ──────────────────────────────
const verifyIdentity = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'ID proof file required' });
    }

    const uploadRes = await uploadFile(file, 'id-proofs');
    
    await query(
      `UPDATE user_profiles SET id_proof_url = $1, id_proof_s3_key = $2, is_id_verified = false WHERE user_id = $3`,
      [uploadRes.url, uploadRes.s3Key, userId]
    );

    res.json({ success: true, message: 'Govt ID uploaded successfully. Admin will verify it soon.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMatchExplanation,
  uploadVideoSelfie,
  reportProfile,
  blockProfile,
  verifyIdentity,
};
