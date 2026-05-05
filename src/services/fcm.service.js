/**
 * FCM Notification Service – GraceMatch
 */

const path = require('path');
const { query } = require('../db');

let firebaseAdmin = null;

const initFirebase = () => {
  if (firebaseAdmin) return firebaseAdmin;

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccountPath = path.resolve(__dirname, '../service_account.json');
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
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
  if (!admin) {
    console.warn(`⚠️ Push skipped: Firebase not initialized for user ${userId}`);
    return;
  }

  try {
    // Get all FCM tokens for user (they may have multiple devices)
    const result = await query(
      'SELECT token, device_type FROM fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      console.warn(`⚠️ Push skipped: no FCM tokens for user ${userId}`);
      return;
    }

    const messages = result.rows
      .filter(({ token }) => typeof token === 'string' && token.trim().length > 0)
      .map(({ token }) => ({
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
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    }));

    if (messages.length === 0) {
      console.warn(`⚠️ Push skipped: all FCM tokens invalid/empty for user ${userId}`);
      return;
    }

    const responses = await admin.messaging().sendEach(messages);
    const successCount = responses.responses.filter((r) => r.success).length;
    const failureCount = responses.responses.length - successCount;
    if (failureCount > 0) {
      console.warn(`⚠️ FCM partial delivery for user ${userId}: ${successCount} success, ${failureCount} failed`);
    }

    // Remove invalid tokens
    const invalidTokens = [];
    responses.responses.forEach((resp, i) => {
      if (!resp.success) {
        const errCode = resp.error?.code;
        console.warn(`⚠️ FCM token failure for user ${userId}: ${errCode || 'unknown_error'}`);
        if (
          errCode === 'messaging/invalid-registration-token' ||
          errCode === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(messages[i].token);
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
  if (!token || typeof token !== 'string' || token.trim().length === 0) return;
  await query(
    `INSERT INTO fcm_tokens (user_id, token, device_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (token)
     DO UPDATE SET user_id = EXCLUDED.user_id, device_type = EXCLUDED.device_type, updated_at = NOW()`,
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
