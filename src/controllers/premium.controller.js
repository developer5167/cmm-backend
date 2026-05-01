const { query } = require('../db');
const { sendPushToUser } = require('../services/fcm.service');

// ─── HELPER: Check Subscription Premium Feature ────────────────
const checkPremiumFeature = async (userId, featureKey) => {
  const result = await query(
    `SELECT p.features FROM subscriptions s
     JOIN subscription_plans p ON s.plan_id = p.id
     WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > NOW()`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  return !!result.rows[0].features[featureKey];
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

    const hasPremium = await checkPremiumFeature(requesterId, 'direct_contact_view');
    if (!hasPremium) {
      return res.status(403).json({ success: false, message: 'Requires Premium Subscription' });
    }

    // Check if target user allows sharing instantly
    const targetProf = await query(`SELECT is_contact_sharing_allowed, first_name FROM user_profiles WHERE user_id = $1`, [target_user_id]);
    const allowed = targetProf.rows[0]?.is_contact_sharing_allowed;

    if (allowed) {
      // Just give contact details immediately
      const contactInfo = await query(`SELECT phone_number FROM users WHERE id = $1`, [target_user_id]);
      await query(`INSERT INTO contact_requests (requester_id, target_user_id, status) VALUES ($1, $2, 'approved')`, [requesterId, target_user_id]);
      return res.json({ success: true, message: 'Contact sharing is open', data: contactInfo.rows[0] });
    }

    // Otherwise, create pending request
    const existing = await query(`SELECT id, status FROM contact_requests WHERE requester_id = $1 AND target_user_id = $2`, [requesterId, target_user_id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: `Request is already ${existing.rows[0].status}` });
    }

    const result = await query(
      `INSERT INTO contact_requests (requester_id, target_user_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [requesterId, target_user_id]
    );

    const senderProfile = await query(`SELECT first_name FROM user_profiles WHERE user_id = $1`, [requesterId]);
    const fname = senderProfile.rows[0]?.first_name || 'Someone';

    await sendPushToUser(target_user_id, {
      title: 'Contact Request',
      body: `${fname} wants to view your contact details.`
    }, { type: 'contact_request' });

    res.json({ success: true, message: 'Request sent to user for approval' });
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
      `UPDATE contact_requests SET status = $1, responded_at = NOW() WHERE id = $2 AND target_user_id = $3 AND status = 'pending' RETURNING requester_id`,
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

module.exports = {
  buySpotlight,
  requestContact,
  respondContact,
};
