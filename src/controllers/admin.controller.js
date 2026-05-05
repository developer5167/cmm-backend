const { query } = require('../db');
const bcrypt = require('bcryptjs');
const { sendPushToUser } = require('../services/fcm.service');
const { deleteFile } = require('../services/storage.service');

// ─── AUDIT LOG HELPER ─────────────────────────────────────────
const logAudit = async (adminId, action, targetType, targetId, details = {}, req = null) => {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null;
    await query(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, action, targetType, targetId, JSON.stringify(details), ip]
    );
  } catch (err) {
    console.error('Audit Log Error:', err);
  }
};

// ─── STAFF MANAGEMENT ─────────────────────────────────────────

const createStaff = async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body; // role: 'moderator' by default

    const existing = await query('SELECT id FROM admin_users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await query(
      `INSERT INTO admin_users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, role`,
      [email, hash, name, role || 'moderator']
    );

    await logAudit(req.user.id, 'CREATE_STAFF', 'staff', result.rows[0].id, { email }, req);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

const toggleStaffStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const result = await query(
      'UPDATE admin_users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active',
      [is_active, id]
    );

    await logAudit(req.user.id, is_active ? 'ACTIVATE_STAFF' : 'DEACTIVATE_STAFF', 'staff', id, {}, req);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

const getStaff = async (req, res, next) => {
  try {
    const result = await query('SELECT id, email, name, role, is_active, last_login_at, created_at FROM admin_users ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── REVISION LOCKING ─────────────────────────────────────────

const lockRevision = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    // Check if already locked by someone else (and lock hasn't expired - e.g. 15 mins)
    const check = await query(
      `SELECT locked_by, locked_at FROM profile_revisions 
       WHERE id = $1`,
      [id]
    );

    if (check.rows.length === 0) return res.status(404).json({ success: false, message: 'Revision not found' });

    const rev = check.rows[0];
    const now = new Date();
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60000);

    if (rev.locked_by && rev.locked_by !== adminId && rev.locked_at > fifteenMinsAgo) {
      return res.status(409).json({ success: false, message: 'Revision is currently locked by another staff' });
    }

    await query(
      'UPDATE profile_revisions SET locked_by = $1, locked_at = NOW() WHERE id = $2',
      [adminId, id]
    );

    res.json({ success: true, message: 'Revision locked' });
  } catch (err) {
    next(err);
  }
};

const unlockRevision = async (req, res, next) => {
  try {
    const { id } = req.params;
    await query('UPDATE profile_revisions SET locked_by = NULL, locked_at = NULL WHERE id = $1', [id]);
    res.json({ success: true, message: 'Revision unlocked' });
  } catch (err) {
    next(err);
  }
};

// ─── REVISIONS ────────────────────────────────────────────

const getPendingRevisions = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, u.phone_number, p.first_name, p.last_name, a.name as locked_by_name 
       FROM profile_revisions r
       JOIN users u ON r.user_id = u.id
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN admin_users a ON r.locked_by = a.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC`
    );

    // Clean up expired locks in the response
    const now = new Date();
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60000);

    const rows = result.rows.map(row => {
      if (row.locked_at && row.locked_at < fifteenMinsAgo) {
        row.locked_by = null;
        row.locked_by_name = null;
      }
      return row;
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── APPROVE/REJECT Revision ──────────────────────────────────
const reviewRevision = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;
    const adminId = req.user.id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const revisionRes = await query('SELECT * FROM profile_revisions WHERE id = $1', [id]);
    if (revisionRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Revision not found' });
    }

    const revision = revisionRes.rows[0];

    if (status === 'approved') {
      const field = revision.field_name;
      const value = revision.new_value;
      const userId = revision.user_id;

      let table = 'user_profiles';
      if (['education_preference', 'profession_preference'].includes(field)) {
        table = 'user_partner_preferences';
      }

      await query(
        `UPDATE ${table} SET ${field} = $1, updated_at = NOW() WHERE user_id = $2`,
        [value, userId]
      );
    }

    await query(
      `UPDATE profile_revisions 
       SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW(), 
           locked_by = NULL, locked_at = NULL
       WHERE id = $4`,
      [status, rejection_reason || null, adminId, id]
    );

    // Notify user about revision decision.
    const revisionNotification = status === 'approved'
      ? {
          title: 'Profile Update Approved',
          body: 'Your recent profile change has been approved and is now live.',
        }
      : {
          title: 'Profile Update Rejected',
          body: 'One of your profile changes was rejected. Please review and submit again.',
        };
    await sendPushToUser(revision.user_id, revisionNotification, {
      type: 'PROFILE_REVISION_RESULT',
      status,
      field: revision.field_name,
      revision_id: id,
    });

    await logAudit(adminId, status === 'approved' ? 'APPROVE_REVISION' : 'REJECT_REVISION', 'revision', id, { field: revision.field_name }, req);

    res.json({ success: true, message: `Revision ${status} successfully` });
  } catch (err) {
    next(err);
  }
};

// ─── NEW USER APPLICATIONS ───────────────────────────────────
 
const getPendingApplications = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, u.phone_number, a.name as locked_by_name,
        (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.photo_url, 'is_approved', ph.is_approved, 'review_status', ph.review_status, 'is_primary', ph.is_primary) ORDER BY ph.order_index) 
         FROM user_photos ph WHERE ph.user_id = p.user_id) as photos,
        (SELECT json_agg(h.name) 
         FROM user_hobbies uh 
         JOIN hobbies h ON uh.hobby_id = h.id 
         WHERE uh.user_id = p.user_id) as hobbies,
        (SELECT row_to_json(f.*) FROM user_family f WHERE f.user_id = p.user_id) as family
       FROM user_profiles p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN admin_users a ON p.locked_by = a.id
       WHERE p.review_status = 'pending' AND u.is_onboarding_complete = true
       ORDER BY p.created_at ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

const lockApplication = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    // Check if already locked by someone else
    const current = await query(
      'SELECT locked_by, locked_at FROM user_profiles WHERE user_id = $1',
      [userId]
    );

    if (current.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    if (current.rows[0].locked_by && current.rows[0].locked_by !== adminId) {
      const lockTime = new Date(current.rows[0].locked_at);
      const now = new Date();
      // Auto unlock after 15 mins
      if (now - lockTime < 15 * 60 * 1000) {
        return res.status(403).json({ success: false, message: 'This application is currently being reviewed by another staff member.' });
      }
    }

    await query(
      'UPDATE user_profiles SET locked_by = $1, locked_at = NOW() WHERE user_id = $2',
      [adminId, userId]
    );

    res.json({ success: true, message: 'Application locked for review' });
  } catch (err) {
    next(err);
  }
};

const unlockApplication = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await query('UPDATE user_profiles SET locked_by = NULL, locked_at = NULL WHERE user_id = $1', [userId]);
    res.json({ success: true, message: 'Application unlocked' });
  } catch (err) {
    next(err);
  }
};

const reviewApplication = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status, note } = req.body; // status: 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    await query(
      'UPDATE user_profiles SET review_status = $1, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE user_id = $2',
      [status, userId]
    );

    await logAudit(req.user.id, status === 'approved' ? 'APPROVE_APP' : 'REJECT_APP', 'user', userId, { note }, req);

    // Send Push Notification
    const notification = status === 'approved' 
      ? { title: 'Account Approved! 🎉', body: 'Welcome to GraceMatch! Your profile is now live and you can start discovering matches.' }
      : { title: 'Account Update', body: 'There was an issue with your profile application. Please contact support for more details.' };
    
    await sendPushToUser(userId, notification, { type: 'APPLICATION_RESULT', status });

    res.json({ success: true, message: `Application ${status} successfully` });
  } catch (err) {
    next(err);
  }
};
 
// ─── PHOTO REVIEW ─────────────────────────────────────────────

const getPendingPhotos = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         ph.id, ph.photo_url, ph.is_primary, ph.created_at,
         p.user_id, p.first_name, p.last_name,
         u.phone_number
       FROM user_photos ph
       JOIN user_profiles p ON p.user_id = ph.user_id
       JOIN users u ON u.id = ph.user_id
       WHERE ph.review_status = 'pending'
       ORDER BY ph.created_at ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

const reviewPhoto = async (req, res, next) => {
  try {
    const { photoId } = req.params;
    const { status, rejection_reason } = req.body;
    const adminId = req.user.id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const photoRes = await query('SELECT * FROM user_photos WHERE id = $1', [photoId]);
    if (photoRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Photo not found' });
    }
    const photo = photoRes.rows[0];

    const isApproved = status === 'approved';
    await query(
      `UPDATE user_photos
       SET is_approved = $1, review_status = $2, rejection_reason = $3,
           reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $5`,
      [isApproved, status, rejection_reason || null, adminId, photoId]
    );

    // Delete the file from storage when rejected so it doesn't consume space
    if (!isApproved && photo.s3_key) {
      try {
        await deleteFile(photo.s3_key);
      } catch (delErr) {
        console.warn(`⚠️ Could not delete file for rejected photo ${photoId}:`, delErr.message);
      }
    }

    const notification = isApproved
      ? {
          title: 'Photo Approved',
          body: 'Your photo has been approved and is now visible on your profile.',
        }
      : {
          title: 'Photo Rejected',
          body: rejection_reason
            ? `Your photo was rejected: ${rejection_reason}`
            : 'Your photo did not meet our guidelines. Please upload a different photo.',
        };

    await sendPushToUser(photo.user_id, notification, {
      type: 'PHOTO_REVIEW_RESULT',
      status,
      photo_id: String(photoId),
      reason: rejection_reason || '',
    });

    await logAudit(
      adminId,
      isApproved ? 'APPROVE_PHOTO' : 'REJECT_PHOTO',
      'photo',
      photoId,
      { reason: rejection_reason },
      req
    );

    res.json({ success: true, message: `Photo ${status} successfully` });
  } catch (err) {
    next(err);
  }
};

// ─── PER-USER ACTIVITY STATS (admin use only) ────────────────

const getUserViewStats = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await query(
      `SELECT COUNT(*) AS total FROM profile_views WHERE viewed_id = $1`,
      [userId]
    );
    res.json({ success: true, data: { total: parseInt(result.rows[0].total) } });
  } catch (err) { next(err); }
};

const getUserShortlistStats = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await query(
      `SELECT COUNT(*) AS total FROM shortlists WHERE shortlisted_user_id = $1`,
      [userId]
    );
    res.json({ success: true, data: { total: parseInt(result.rows[0].total) } });
  } catch (err) { next(err); }
};

const getUserNotifStats = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [totalRes, unreadRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1`, [userId]),
      query(`SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = false`, [userId]),
    ]);
    res.json({
      success: true,
      data: {
        total: parseInt(totalRes.rows[0].total),
        unread: parseInt(unreadRes.rows[0].unread),
      },
    });
  } catch (err) { next(err); }
};

// ─── PENDING ID Verifications ─────────────────────────────────
const getPendingVerifications = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.user_id, p.first_name, p.last_name, p.id_proof_url,
              p.is_id_verified, p.updated_at,
              u.phone_number,
              (SELECT photo_url FROM user_photos
               WHERE user_id = p.user_id AND is_approved = true AND is_primary = true
               LIMIT 1) as primary_photo
       FROM user_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.id_proof_url IS NOT NULL AND p.is_id_verified = false
       ORDER BY p.updated_at ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ─── APPROVE / REJECT ID Verification ────────────────────────
const reviewVerification = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { action, reason } = req.body; // action: 'approve' | 'reject'
    const adminId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
    }

    if (action === 'approve') {
      // Mark ID as verified and recalculate trust badge
      await query(
        `UPDATE user_profiles SET is_id_verified = true, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );
      // Recalculate trust badge (church + denomination + verified = badge)
      const prof = await query(
        `SELECT church_name, denomination FROM user_profiles WHERE user_id = $1`,
        [userId]
      );
      const p = prof.rows[0] ?? {};
      const badge = !!(p.church_name && p.denomination);
      await query(
        `UPDATE user_profiles SET trust_badge = $1 WHERE user_id = $2`,
        [badge, userId]
      );
    } else {
      // Clear the uploaded proof so they can re-upload
      await query(
        `UPDATE user_profiles SET id_proof_url = NULL, id_proof_s3_key = NULL, is_id_verified = false WHERE user_id = $1`,
        [userId]
      );
    }

    // Notify the user
    const { sendPushToUser } = require('../services/fcm.service');
    if (action === 'approve') {
      await sendPushToUser(userId, {
        title: 'Identity Verified ✓',
        body: 'Your ID has been verified. Your profile now has a trust badge!',
      }, { type: 'identity_verified' });
    } else {
      await sendPushToUser(userId, {
        title: 'ID Verification Failed',
        body: reason || 'Your ID could not be verified. Please upload a clearer document.',
      }, { type: 'identity_rejected' });
    }

    res.json({ success: true, message: `Verification ${action}d successfully` });
  } catch (err) { next(err); }
};

module.exports = {
  getPendingRevisions,
  reviewRevision,
  createStaff,
  getStaff,
  toggleStaffStatus,
  lockRevision,
  unlockRevision,
  getPendingApplications,
  reviewApplication,
  lockApplication,
  unlockApplication,
  getPendingPhotos,
  reviewPhoto,
  getUserViewStats,
  getUserShortlistStats,
  getUserNotifStats,
  getPendingVerifications,
  reviewVerification,
};
