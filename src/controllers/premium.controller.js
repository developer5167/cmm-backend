const { query } = require('../db');
const { sendPushToUser } = require('../services/fcm.service');

// ─── HELPER: Get active subscription + features ────────────────
const getActiveSubscriptionFeatures = async (userId) => {
  const result = await query(
    `SELECT s.id, s.plan_id, p.name AS plan_name, p.features
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.user_id = $1
        AND s.status = 'active'
        AND s.expires_at > NOW()
      ORDER BY s.expires_at DESC
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
};

// ─── BUY Spotlight Boost ───────────────────────────────────────
const buySpotlight = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // We assume they consume 1 credit of spotlight, or it is a paid feature directly.
    // For MVP, if they call this and have premium, they get it, or they can trigger Razorpay. 
    // Let's assume standard trigger for now mock.
    
    // Deactivate old spotlights
    await query(`UPDATE spotlight_boosts SET is_active = false WHERE user_id = $1`, [userId]);

    // Insert new 24 hr spotlight
    const result = await query(
      `INSERT INTO spotlight_boosts (user_id, starts_at, ends_at, is_active) 
       VALUES ($1, NOW(), NOW() + INTERVAL '24 hours', true) RETURNING *`,
      [userId]
    );

    res.json({ success: true, message: 'Spotlight activated for 24 hours!', data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── REQUEST Contact Details ──────────────────────────────────
const requestContact = async (req, res, next) => {
  try {
    const requesterId = req.user.id;
    const { target_user_id } = req.body;

    if (requesterId === target_user_id) {
       return res.status(400).json({ success: false, message: 'Cannot request your own contact' });
    }

    const activeSub = await getActiveSubscriptionFeatures(requesterId);
    if (!activeSub) {
      return res.status(403).json({ success: false, message: 'Requires Premium Subscription' });
    }

    // contact_reveals_per_month is the source of truth from plan features.
    // -1 => unlimited, 0/undefined => not allowed.
    const rawLimit = activeSub.features?.contact_reveals_per_month;
    const monthlyLimit =
      rawLimit === -1
        ? -1
        : Number.isFinite(Number(rawLimit))
            ? Number(rawLimit)
            : 0;

    if (monthlyLimit === 0) {
      return res.status(403).json({
        success: false,
        message: 'Your current plan does not include contact reveals',
      });
    }

    if (monthlyLimit > 0) {
      const usedRes = await query(
        `SELECT COUNT(*)::int AS used
           FROM contact_requests
          WHERE requester_id = $1
            AND status = 'approved'
            AND COALESCE(responded_at, requested_at) >= date_trunc('month', NOW())`,
        [requesterId]
      );
      const used = usedRes.rows[0]?.used ?? 0;
      if (used >= monthlyLimit) {
        return res.status(403).json({
          success: false,
          message: `Monthly contact reveal limit reached (${monthlyLimit})`,
        });
      }
    }

    // Check if target user accepts contact requests
    const targetProf = await query(`SELECT is_contact_sharing_allowed, first_name FROM user_profiles WHERE user_id = $1`, [target_user_id]);
    const allowed = targetProf.rows[0]?.is_contact_sharing_allowed;

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'This user is not accepting contact requests right now.',
      });
    }

    // Create pending request — phone should only be visible after approval.
    const existing = await query(
      `SELECT id, status FROM contact_requests WHERE requester_id = $1 AND target_user_id = $2`,
      [requesterId, target_user_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: `Request is already ${existing.rows[0].status}` });
    }

    await query(
      `INSERT INTO contact_requests (requester_id, target_user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id`,
      [requesterId, target_user_id]
    );

    const senderProfile = await query(`SELECT first_name FROM user_profiles WHERE user_id = $1`, [requesterId]);
    const fname = senderProfile.rows[0]?.first_name || 'Someone';

    await sendPushToUser(target_user_id, {
      title: 'Contact Request',
      body: `${fname} wants to view your contact details.`
    }, { type: 'contact_request' });

    res.json({ success: true, message: 'Contact request sent. Waiting for approval.' });
  } catch (err) {
    next(err);
  }
};

// ─── APPROVE/REJECT Contact Details ───────────────────────────
const respondContact = async (req, res, next) => {
  try {
    const targetUserId = req.user.id;
    const { id } = req.params;
    const { action } = req.body; // 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    const status = action === 'approve' ? 'approved' : 'rejected';

    const reqRes = await query(
      `UPDATE contact_requests SET status = $1, responded_at = NOW()
       WHERE id = $2 AND target_user_id = $3 AND status = 'pending'
       RETURNING requester_id`,
      [status, id, targetUserId]
    );

    if (reqRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found or already responded' });
    }

    const { requester_id } = reqRes.rows[0];

    const targetProfile = await query(`SELECT first_name FROM user_profiles WHERE user_id = $1`, [targetUserId]);
    const fname = targetProfile.rows[0]?.first_name || 'The user';

    await sendPushToUser(requester_id, {
      title: `Contact Request ${status === 'approved' ? 'Approved' : 'Declined'}`,
      body: `${fname} ${status === 'approved' ? 'approved' : 'declined'} your request.`
    }, { type: 'contact_response' });

    res.json({ success: true, message: `Contact request ${status}` });
  } catch(err) {
    next(err);
  }
};

// ─── GET Contact Status with a Specific User ─────────────────
// Returns the status of any contact request between the logged-in user and a target.
const getContactStatus = async (req, res, next) => {
  try {
    const myId      = req.user.id;
    const { targetUserId } = req.params;

    // Check outgoing (I requested theirs)
    const outgoing = await query(
      `SELECT id, status, responded_at FROM contact_requests
       WHERE requester_id = $1 AND target_user_id = $2
       ORDER BY requested_at DESC LIMIT 1`,
      [myId, targetUserId]
    );

    // Check incoming (they requested mine)
    const incoming = await query(
      `SELECT id, status, responded_at FROM contact_requests
       WHERE requester_id = $1 AND target_user_id = $2
       ORDER BY requested_at DESC LIMIT 1`,
      [targetUserId, myId]
    );

    let phone = null;
    const outRow = outgoing.rows[0];
    const inRow  = incoming.rows[0];

    // Reveal phone if outgoing was approved
    if (outRow?.status === 'approved') {
      const phoneRes = await query('SELECT phone_number FROM users WHERE id = $1', [targetUserId]);
      phone = phoneRes.rows[0]?.phone_number ?? null;
    }

    res.json({
      success: true,
      data: {
        outgoing: outRow
          ? { id: outRow.id, status: outRow.status, responded_at: outRow.responded_at }
          : null,
        incoming: inRow
          ? { id: inRow.id, status: inRow.status }
          : null,
        phone, // non-null only when outgoing === approved
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET Incoming Contact Requests (for Activity tab) ────────
const getIncomingContactRequests = async (req, res, next) => {
  try {
    const myId = req.user.id;

    const result = await query(
      `SELECT cr.id, cr.requester_id AS user_id, cr.status, cr.requested_at, cr.responded_at,
              p.first_name, p.profession, p.denomination,
              (SELECT photo_url FROM user_photos
               WHERE user_id = cr.requester_id AND is_approved = true AND is_primary = true
               LIMIT 1) as primary_photo
       FROM contact_requests cr
       JOIN user_profiles p ON p.user_id = cr.requester_id
       WHERE cr.target_user_id = $1
       ORDER BY cr.requested_at DESC`,
      [myId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  buySpotlight,
  requestContact,
  respondContact,
  getContactStatus,
  getIncomingContactRequests,
};
