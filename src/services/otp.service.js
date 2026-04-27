/**
 * OTP Service – GraceMatch
 * Dev mode: prints OTP to console
 * Prod mode: sends via MSG91 (primary) or Twilio (fallback)
 */

require('dotenv').config();
const axios = require('axios');

/**
 * Send OTP via MSG91
 */
const sendViaMSG91 = async (phone, otp) => {
  const url = 'https://api.msg91.com/api/v5/otp';
  await axios.post(
    url,
    {
      template_id: process.env.MSG91_TEMPLATE_ID,
      mobile: phone,
      authkey: process.env.MSG91_AUTH_KEY,
      otp,
    },
    { timeout: 8000 }
  );
};

/**
 * Send OTP via Twilio
 */
const sendViaTwilio = async (phone, otp) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    new URLSearchParams({
      From: from,
      To: phone,
      Body: `Your GraceMatch OTP is: ${otp}. Valid for ${process.env.OTP_EXPIRES_IN_MINUTES || 10} minutes. Do not share this with anyone.`,
    }),
    {
      auth: { username: accountSid, password: authToken },
      timeout: 8000,
    }
  );
};

/**
 * Main send function – picks provider based on env config
 * @param {string} phone - E.164 formatted phone number
 * @param {string} otp - 6-digit OTP
 */
const sendOTP = async (phone, otp) => {
  const provider = process.env.OTP_PROVIDER || 'console';

  if (provider === 'console' || process.env.NODE_ENV === 'development') {
    // Development: just log it
    console.log('\n');
    console.log('═══════════════════════════════════');
    console.log(`  📱 OTP for ${phone}`);
    console.log(`  🔑 Code: ${otp}`);
    console.log('═══════════════════════════════════\n');
    return;
  }

  if (provider === 'msg91') {
    await sendViaMSG91(phone, otp);
    return;
  }

  if (provider === 'twilio') {
    await sendViaTwilio(phone, otp);
    return;
  }

  throw new Error(`Unknown OTP provider: ${provider}`);
};

module.exports = { sendOTP };
