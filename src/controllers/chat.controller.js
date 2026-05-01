const { query } = require('../db');
const { sendPushToUser } = require('../services/fcm.service');
const { uploadFile } = require('../services/storage.service');
const socketService = require('../services/socket.service');

// ─── CHECK Permissions Helper ─────────────────────────────────
const checkConversationAccess = async (conversationId, userId) => {
  const result = await query(
    `SELECT id, user1_id, user2_id FROM conversations WHERE id = $1`,
    [conversationId]
  );
  if (result.rows.length === 0) return null;
  const c = result.rows[0];
  if (c.user1_id !== userId && c.user2_id !== userId) return null;
  
  // also check if any user is blocked
  const otherUserId = c.user1_id === userId ? c.user2_id : c.user1_id;
  const blockCheck = await query(
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [userId, otherUserId]
  );
  if (blockCheck.rows.length > 0) return { error: 'Action not allowed' };

  return { conversation: c, otherUserId };
};

// ─── GET Conversations List ───────────────────────────────────
const getConversationsList = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const sql = `
      SELECT 
        c.id as conversation_id, c.last_message_at,
        p.user_id as other_user_id, p.first_name as other_user_name,
        u.last_seen_at,
        (SELECT url FROM (SELECT json_build_object('url', ph.photo_url)->>'url' as url FROM user_photos ph WHERE ph.user_id = p.user_id AND ph.is_approved = true AND ph.is_primary = true LIMIT 1) sub) as other_user_photo,
        (SELECT json_build_object('content', m.content, 'message_type', m.message_type, 'sender_id', m.sender_id, 'created_at', m.created_at, 'is_read', m.is_read) 
         FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != $1 AND m.is_read = false) as unread_count
      FROM conversations c
      JOIN user_profiles p ON p.user_id = CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END
      JOIN users u ON u.id = p.user_id
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `;

    const listRes = await query(sql, [userId, limit, offset]);

    // Enrich with live online status from socket service
    let srv;
    try { srv = socketService.getInstance(); } catch (_) {}

    const conversations = listRes.rows.map(row => ({
      ...row,
      is_online: srv ? srv.isOnline(row.other_user_id) : false,
    }));

    res.json({ success: true, data: { conversations } });
  } catch (err) {
    next(err);
  }
};

// ─── SEND Message ─────────────────────────────────────────────
const sendMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { content, message_type = 'text' } = req.body;
    const file = req.file;

    const access = await checkConversationAccess(conversationId, userId);
    if (!access) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (access.error) return res.status(403).json({ success: false, message: access.error });

    let photo_url = null, photo_s3_key = null;
    
    if (message_type === 'photo' && file) {
      const uploadRes = await uploadFile(file, 'chat-photos');
      photo_url = uploadRes.url;
      photo_s3_key = uploadRes.s3Key;
    } else if (message_type === 'text' && (!content || content.trim() === '')) {
      return res.status(400).json({ success: false, message: 'Message content cannot be empty' });
    }

    // Insert Message
    const msgRes = await query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type, photo_url, photo_s3_key) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [conversationId, userId, content, message_type, photo_url, photo_s3_key]
    );
    const messageData = msgRes.rows[0];

    // Update conversation last_message_at
    await query(
      `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    // 1. Emit real-time socket event
    let receiverOnline = false;
    try {
      const srv = socketService.getInstance();
      // Send to receiver
      receiverOnline = srv.emitToUser(access.otherUserId, 'new_message', messageData);
      // If receiver's socket is active, send a delivered receipt back to sender
      if (receiverOnline) {
        srv.emitToUser(userId, 'message_delivered', {
          message_id: messageData.id,
          conversation_id: conversationId,
        });
      }
    } catch (sErr) {
      console.warn('⚠️ Socket emission failed:', sErr.message);
    }

    // 2. Always send push — Flutter suppresses it on the receiver's side
    //    only when they are actively inside this specific conversation.
    //    This covers: app in background, app open on different screen, app killed.
    const senderProfile = await query(
      `SELECT first_name FROM user_profiles WHERE user_id = $1`, [userId]
    );
    const fname = senderProfile.rows[0]?.first_name || 'Someone';

    let bodyText = message_type === 'photo' ? 'Sent a photo' : content;
    if (bodyText && bodyText.length > 50) bodyText = bodyText.substring(0, 47) + '...';

    await sendPushToUser(access.otherUserId, {
      title: `New message from ${fname}`,
      body: bodyText,
    }, {
      type: 'new_message',
      conversation_id: conversationId,
      message_id: messageData.id,
      sender_id: userId,
    });

    res.json({ success: true, message: 'Message sent', data: messageData });
  } catch (err) {
    next(err);
  }
};

// ─── GET Messages (History) ───────────────────────────────────
const getMessages = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const access = await checkConversationAccess(conversationId, userId);
    if (!access) return res.status(404).json({ success: false, message: 'Conversation not found' });
    
    // Mark unread messages as read and capture their IDs for socket receipt
    const markedRes = await query(
      `UPDATE messages SET is_read = true, read_at = NOW() 
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false
       RETURNING id`,
      [conversationId, userId]
    );

    // Notify the sender that their messages were read
    if (markedRes.rows.length > 0) {
      try {
        const srv = socketService.getInstance();
        srv.emitToUser(access.otherUserId, 'messages_read', {
          conversation_id: conversationId,
          message_ids: markedRes.rows.map(r => r.id),
          read_by: userId,
        });
      } catch (sErr) {
        console.warn('⚠️ Socket read receipt failed:', sErr.message);
      }
    }

    const messages = await query(
      `SELECT id, sender_id, content, message_type, photo_url, is_read, read_at, created_at 
       FROM messages 
       WHERE conversation_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );

    res.json({ success: true, data: { messages: messages.rows } });
  } catch (err) {
    next(err);
  }
};

// ─── MARK Messages as Read ────────────────────────────────────
// Lightweight endpoint called by the receiver while they are actively
// viewing the chat — marks new socket-delivered messages as read and
// emits the read receipt back to the sender in real time.
const markRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const access = await checkConversationAccess(conversationId, userId);
    if (!access) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (access.error) return res.status(403).json({ success: false, message: access.error });

    const markedRes = await query(
      `UPDATE messages SET is_read = true, read_at = NOW()
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false
       RETURNING id`,
      [conversationId, userId]
    );

    if (markedRes.rows.length > 0) {
      try {
        const srv = socketService.getInstance();
        srv.emitToUser(access.otherUserId, 'messages_read', {
          conversation_id: conversationId,
          message_ids: markedRes.rows.map(r => r.id),
          read_by: userId,
        });
      } catch (sErr) {
        console.warn('⚠️ Socket read receipt failed:', sErr.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ─── GET User Online Status ───────────────────────────────────
const getUserStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const userRes = await query(
      'SELECT last_seen_at FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let srv;
    try { srv = socketService.getInstance(); } catch (_) {}
    const is_online = srv ? srv.isOnline(userId) : false;

    res.json({
      success: true,
      data: {
        user_id: userId,
        is_online,
        last_seen_at: userRes.rows[0].last_seen_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getConversationsList,
  sendMessage,
  getMessages,
  markRead,
  getUserStatus,
};
