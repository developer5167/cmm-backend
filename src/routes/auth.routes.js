const express = require('express');
const { body } = require('express-validator');

const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  sendOTPHandler,
  verifyOTPHandler,
  refreshTokenHandler,
  logoutHandler,
  updateFCMTokenHandler,
} = require('../controllers/auth.controller');

// ─────────────────────────────────────────────────────────────
// Validation Chains
// ─────────────────────────────────────────────────────────────

const sendOTPValidation = [
  body('phone_number')
    .notEmpty().withMessage('Phone number is required')
    .isLength({ min: 10, max: 13 }).withMessage('Invalid phone number length')
    .matches(/^[0-9]+$/).withMessage('Phone number must contain only digits'),
  body('country_code')
    .optional()
    .matches(/^\+[0-9]{1,4}$/).withMessage('Invalid country code format (e.g. +91)'),
];

const verifyOTPValidation = [
  body('phone_number')
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9]+$/).withMessage('Phone number must contain only digits'),
  body('otp')
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits')
    .isNumeric().withMessage('OTP must be numeric'),
  body('country_code')
    .optional()
    .matches(/^\+[0-9]{1,4}$/).withMessage('Invalid country code'),
  body('fcm_token')
    .optional()
    .isString().withMessage('FCM token must be a string'),
  body('device_type')
    .optional()
    .isIn(['android', 'ios']).withMessage('Device type must be android or ios'),
];

const refreshValidation = [
  body('refresh_token')
    .notEmpty().withMessage('Refresh token is required'),
];

const logoutValidation = [
  body('fcm_token')
    .optional()
    .isString(),
];

const fcmTokenValidation = [
  body('fcm_token')
    .notEmpty().withMessage('FCM token is required'),
  body('device_type')
    .notEmpty().withMessage('Device type is required')
    .isIn(['android', 'ios']).withMessage('Device type must be android or ios'),
];

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/auth/send-otp
 * @desc    Send OTP to phone number
 * @access  Public
 */
router.post('/send-otp', sendOTPValidation, validate, sendOTPHandler);

/**
 * @route   POST /api/v1/auth/verify-otp
 * @desc    Verify OTP, create/login user, return JWT tokens
 * @access  Public
 */
router.post('/verify-otp', verifyOTPValidation, validate, verifyOTPHandler);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', refreshValidation, validate, refreshTokenHandler);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user, remove FCM token
 * @access  Private
 */
router.post('/logout', authMiddleware, logoutValidation, validate, logoutHandler);

/**
 * @route   PUT /api/v1/auth/fcm-token
 * @desc    Register or update FCM push notification token
 * @access  Private
 */
router.put('/fcm-token', authMiddleware, fcmTokenValidation, validate, updateFCMTokenHandler);

module.exports = router;
