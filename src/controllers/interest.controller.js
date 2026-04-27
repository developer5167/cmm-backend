const { query } = require('../db');
const { sendPushToUser } = require('../services/fcm.service');

// ─── SEND Interest ────────────────────────────────────────────
const sendInterest = async (req, res, next) => {
  try {
    const senderId = req.user.id;
    const { receiver_id, is_super_interest } = req.body;

    if (senderId === receiver_id) {
      return res.status(400).json({ success: false, message: 'Cannot send interest to yourself' });
    }

    // Check if block exists
    const blockCheck = await query(
      `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [senderId, receiver_id]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ success: false, message: 'Action not allowed' });
    }

    // Check existing
    const existing = await query(
      `SELECT status, sender_id FROM interests 
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [senderId, receiver_id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Interest already exists' });
    }

    // Handle premium "super_interest" check here if needed later (limit remaining count, etc)

    const result = await query(
      `INSERT INTO interests (sender_id, receiver_id, is_super_interest) 
       VALUES ($1, $2, $3) RETURNING id`,
      [senderId, receiver_id, is_super_interest || false]
    );

    // Fetch sender basic info for push notification
    const senderProfile = await query(
      `SELECT first_name FROM user_profiles WHERE user_id = $1`, [senderId]
    );
    const fname = senderProfile.rows[0]?.first_name || 'Someone';

    // Send Push
    await sendPushToUser(receiver_id, {
      title: 'New Interest Received! 💝',
      body: `${fname} has sent you an interest. Check their profile now.`,
    }, {
      type: 'interest_received',
      interest_id: result.rows[0].id,
      sender_id: senderId
    });

    // Also log in notifications table
    await query(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)`,
      [receiver_id, 'interest_received', 'New Interest Received! 💝', `${fname} has sent you an interest.`, JSON.stringify({ interest_id: result.rows[0].id, sender_id: senderId })]
    );

    res.json({ success: true, message: 'Interest sent successfully', data: { interest_id: result.rows[0].id } });
  } catch (err) {
    next(err);
  }
};

// ─── ACCEPT Interest ──────────────────────────────────────────
const acceptInterest = async (req, res, next) => {
  try {
    const receiverId = req.user.id;
    const { id } = req.params; // interest id

    const interestRes = await query(
      `SELECT * FROM interests WHERE id = $1 AND receiver_id = $2`,
      [id, receiverId]
    );

    if (interestRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Interest not found' });
    }

    const interest = interestRes.rows[0];

    if (interest.status !== 'sent') {
      return res.status(400).json({ success: false, message: `Interest is already ${interest.status}` });
    }

    // Begin Transaction
    const client = await require('../db').getClient();
    try {
      await client.query('BEGIN');

      // Update interest
      await client.query(
        `UPDATE interests SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
        [id]
      );

      // Create Conversation
      await client.query(
        `INSERT INTO conversations (interest_id, user1_id, user2_id) VALUES ($1, $2, $3)`,
        [id, interest.sender_id, receiverId] // User1 is sender, User2 is receiver
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Push notification to sender
    const receiverProfile = await query(
      `SELECT first_name FROM user_profiles WHERE user_id = $1`, [receiverId]
    );
    const fname = receiverProfile.rows[0]?.first_name || 'Someone';

    await sendPushToUser(interest.sender_id, {
      title: 'Interest Accepted! 🎉',
      body: `${fname} accepted your interest. You can now start chatting.`
    }, {
      type: 'interest_accepted',
      interest_id: id,
      receiver_id: receiverId
    });

    await query(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)`,
      [interest.sender_id, 'interest_accepted', 'Interest Accepted! 🎉', `${fname} accepted your interest.`, JSON.stringify({ interest_id: id, receiver_id: receiverId })]
    );

    res.json({ success: true, message: 'Interest accepted. Chat unlocked.' });
  } catch (err) {
    next(err);
  }
};

// ─── REJECT Interest ──────────────────────────────────────────
const rejectInterest = async (req, res, next) => {
  try {
    const receiverId = req.user.id;
    const { id } = req.params;

    const result = await query(
      `UPDATE interests SET status = 'rejected', responded_at = NOW() 
       WHERE id = $1 AND receiver_id = $2 AND status = 'sent' RETURNING id`,
      [id, receiverId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Interest not found or already processed' });
    }

    res.json({ success: true, message: 'Interest rejected' });
  } catch (err) {
    next(err);
  }
};

// ─── GET Lists (Received / Sent / Connected) ──────────────────
const getInterestsList = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const type = req.query.type || 'received'; // received, sent, connected
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let sql = '';
    let queryParams = [userId, limit, offset];

    const selectClause = `
      i.id as interest_id, i.status, i.sent_at, i.is_super_interest,
      p.user_id as profile_id, p.first_name, p.date_of_birth, p.location_city, p.profession,
      (SELECT json_build_object('id', ph.id, 'url', ph.photo_url) 
       FROM user_photos ph WHERE ph.user_id = p.user_id AND ph.is_approved = true AND ph.is_primary = true LIMIT 1) as primary_photo
    `;

    if (type === 'received') {
      sql = `
        SELECT ${selectClause} FROM interests i
        JOIN user_profiles p ON p.user_id = i.sender_id
        WHERE i.receiver_id = $1 AND i.status = 'sent'
        ORDER BY i.is_super_interest DESC, i.sent_at DESC
        LIMIT $2 OFFSET $3
      `;
    } else if (type === 'sent') {
      sql = `
        SELECT ${selectClause} FROM interests i
        JOIN user_profiles p ON p.user_id = i.receiver_id
        WHERE i.sender_id = $1 AND i.status IN ('sent', 'accepted')
        ORDER BY i.sent_at DESC
        LIMIT $2 OFFSET $3
      `;
    } else if (type === 'connected') {
      sql = `
        SELECT ${selectClause}, c.id as conversation_id FROM interests i
        JOIN conversations c ON c.interest_id = i.id
        JOIN user_profiles p ON p.user_id = CASE WHEN i.sender_id = $1 THEN i.receiver_id ELSE i.sender_id END
        WHERE (i.sender_id = $1 OR i.receiver_id = $1) AND i.status = 'accepted'
        ORDER BY c.last_message_at DESC NULLS LAST, i.responded_at DESC
        LIMIT $2 OFFSET $3
      `;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid type' });
    }

    const listRes = await query(sql, queryParams);

    res.json({
      success: true,
      data: listRes.rows
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendInterest,
  acceptInterest,
  rejectInterest,
  getInterestsList,
};
