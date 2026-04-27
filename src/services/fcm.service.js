/**
 * FCM Notification Service – GraceMatch
 */

const { query } = require('../db');

let firebaseAdmin = null;

const initFirebase = () => {
  if (firebaseAdmin) return firebaseAdmin;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.warn('⚠️  Firebase not configured – FCM notifications disabled');
    return null;
  }

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
    firebaseAdmin = admin;
    console.log('✅ Firebase Admin initialized');
    return admin;
  } catch (err) {
    console.error('❌ Firebase init failed:', err.message);
    return null;
  }
};

/**
 * Send FCM push notification to a user
 * @param {string} userId - Target user UUID
 * @param {Object} notification - { title, body }
 * @param {Object} data - Extra data payload
 */
const sendPushToUser = async (userId, notification, data = {}) => {
  const admin = initFirebase();
  if (!admin) return;

  try {
    // Get all FCM tokens for user (they may have multiple devices)
    const result = await query(
      'SELECT token, device_type FROM fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    const messages = result.rows.map(({ token }) => ({
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'gracematch_default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    }));

    const responses = await admin.messaging().sendEach(messages);

    // Remove invalid tokens
    const invalidTokens = [];
    responses.responses.forEach((resp, i) => {
      if (!resp.success) {
        const errCode = resp.error?.code;
        if (
          errCode === 'messaging/invalid-registration-token' ||
          errCode === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(result.rows[i].token);
        }
      }
    });

    if (invalidTokens.length > 0) {
      await query(
        'DELETE FROM fcm_tokens WHERE token = ANY($1)',
        [invalidTokens]
      );
    }
  } catch (err) {
    console.error('❌ FCM send error:', err.message);
  }
};

/**
 * Save or update FCM token for a user
 */
const saveToken = async (userId, token, deviceType) => {
  await query(
    `INSERT INTO fcm_tokens (user_id, token, device_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, device_type)
     DO UPDATE SET token = $2, updated_at = NOW()`,
    [userId, token, deviceType]
  );
};

/**
 * Remove FCM token on logout
 */
const removeToken = async (userId, token) => {
  await query(
    'DELETE FROM fcm_tokens WHERE user_id = $1 AND token = $2',
    [userId, token]
  );
};

module.exports = { sendPushToUser, saveToken, removeToken };
