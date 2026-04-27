/**
 * Auth Controller – GraceMatch
 *
 * Endpoints:
 *   POST /api/v1/auth/send-otp      – Send OTP to phone
 *   POST /api/v1/auth/verify-otp    – Verify OTP, issue tokens
 *   POST /api/v1/auth/refresh        – Refresh access token
 *   POST /api/v1/auth/logout         – Remove FCM token, clear session
 *   PUT  /api/v1/auth/fcm-token      – Register/update FCM push token
 */

const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { sendOTP } = require('../services/otp.service');
const { saveToken, removeToken } = require('../services/fcm.service');
const {
  generateAccessToken,
  generateRefreshToken,
  generateOTP,
  formatPhoneNumber,
} = require('../utils/helpers');

// ─────────────────────────────────────────────────────────────
//  POST /api/v1/auth/send-otp
// ─────────────────────────────────────────────────────────────
const sendOTPHandler = async (req, res, next) => {
  try {
    const { phone_number, country_code = '+91' } = req.body;
    const formattedPhone = formatPhoneNumber(phone_number, country_code);

    // Invalidate all active OTPs for this phone
    await query(
      `UPDATE otp_sessions SET is_used = true
       WHERE phone_number = $1 AND is_used = false`,
      [formattedPhone]
    );

    // Throttle: max 3 OTP requests per phone in last 10 min
    const recentCount = await query(
      `SELECT COUNT(*) FROM otp_sessions
       WHERE phone_number = $1
         AND created_at > NOW() - INTERVAL '10 minutes'`,
      [formattedPhone]
    );

    if (parseInt(recentCount.rows[0].count) >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please wait 10 minutes before trying again.',
      });
    }

    // Generate & store OTP
    const otp = generateOTP();
    const expiresAt = new Date(
      Date.now() + (parseInt(process.env.OTP_EXPIRES_IN_MINUTES) || 10) * 60 * 1000
    );

    await query(
      `INSERT INTO otp_sessions (phone_number, otp_code, expires_at)
       VALUES ($1, $2, $3)`,
      [formattedPhone, otp, expiresAt]
    );

    // Send OTP
    await sendOTP(formattedPhone, otp);

    res.json({
      success: true,
      message: 'OTP sent successfully',
      // Only return in dev for easy testing
      ...(process.env.NODE_ENV === 'development' && { otp }),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/v1/auth/verify-otp
// ─────────────────────────────────────────────────────────────
const verifyOTPHandler = async (req, res, next) => {
  try {
    const { phone_number, country_code = '+91', otp, fcm_token, device_type } = req.body;
    const formattedPhone = formatPhoneNumber(phone_number, country_code);

    // Find the latest unused, unexpired OTP
    const otpResult = await query(
      `SELECT id, attempt_count FROM otp_sessions
       WHERE phone_number = $1
         AND is_used = false
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [formattedPhone]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found. Please request a new OTP.',
      });
    }

    const otpSession = otpResult.rows[0];

    // Max 5 failed attempts
    if (otpSession.attempt_count >= 5) {
      await query(
        'UPDATE otp_sessions SET is_used = true WHERE id = $1',
        [otpSession.id]
      );
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.',
      });
    }

    // Validate OTP code
    const validOtp = await query(
      `SELECT id FROM otp_sessions
       WHERE id = $1 AND otp_code = $2`,
      [otpSession.id, otp]
    );

    if (validOtp.rows.length === 0) {
      // Increment attempt count
      await query(
        'UPDATE otp_sessions SET attempt_count = attempt_count + 1 WHERE id = $1',
        [otpSession.id]
      );
      const remaining = 5 - (otpSession.attempt_count + 1);
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt(s) remaining.`,
      });
    }

    // Mark OTP as used
    await query(
      'UPDATE otp_sessions SET is_used = true WHERE id = $1',
      [otpSession.id]
    );

    // Upsert user — create if new, fetch if existing
    const userResult = await query(
      `INSERT INTO users (phone_number, country_code, is_phone_verified)
       VALUES ($1, $2, true)
       ON CONFLICT (phone_number)
       DO UPDATE SET is_phone_verified = true, last_seen_at = NOW(), updated_at = NOW()
       RETURNING id, phone_number, is_onboarding_complete, onboarding_step, is_active, is_suspended`,
      [formattedPhone, country_code]
    );

    const user = userResult.rows[0];

    if (user.is_suspended) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save FCM token if provided
    if (fcm_token && device_type) {
      await saveToken(user.id, fcm_token, device_type);
    }

    // Determine if user is new (just created)
    const isNewUser = !user.is_onboarding_complete;

    res.json({
      success: true,
      message: isNewUser ? 'Welcome to GraceMatch!' : 'Login successful',
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          phone_number: user.phone_number,
          is_onboarding_complete: user.is_onboarding_complete,
          onboarding_step: user.onboarding_step,
        },
        is_new_user: isNewUser,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/v1/auth/refresh
// ─────────────────────────────────────────────────────────────
const refreshTokenHandler = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === 'TokenExpiredError' ? 'Refresh token expired. Please login again.' : 'Invalid refresh token.',
        code: 'REFRESH_EXPIRED',
      });
    }

    // Validate user still exists and is active
    const userResult = await query(
      `SELECT id, is_active, is_suspended, is_onboarding_complete, onboarding_step
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    const user = userResult.rows[0];

    if (!user.is_active || user.is_suspended) {
      return res.status(403).json({ success: false, message: 'Account inactive or suspended.' });
    }

    // Issue new access token
    const accessToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        user: {
          id: user.id,
          is_onboarding_complete: user.is_onboarding_complete,
          onboarding_step: user.onboarding_step,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/v1/auth/logout
// ─────────────────────────────────────────────────────────────
const logoutHandler = async (req, res, next) => {
  try {
    const { fcm_token } = req.body;

    // Update last seen
    await query(
      'UPDATE users SET last_seen_at = NOW() WHERE id = $1',
      [req.user.id]
    );

    // Remove FCM token if provided
    if (fcm_token) {
      await removeToken(req.user.id, fcm_token);
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
//  PUT /api/v1/auth/fcm-token
// ─────────────────────────────────────────────────────────────
const updateFCMTokenHandler = async (req, res, next) => {
  try {
    const { fcm_token, device_type } = req.body;
    await saveToken(req.user.id, fcm_token, device_type);
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendOTPHandler,
  verifyOTPHandler,
  refreshTokenHandler,
  logoutHandler,
  updateFCMTokenHandler,
};
