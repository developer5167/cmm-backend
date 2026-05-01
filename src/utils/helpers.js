const jwt = require('jsonwebtoken');

/**
 * Parse postgres string array format to JS array
 */
const parsePgArray = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/^{|}$/g, '').trim();
    if (!cleaned) return [];
    return cleaned.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

/**
 * Generate access token (short-lived)
 */
const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
};

/**
 * Generate refresh token (long-lived)
 */
const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
};

/**
 * Generate admin access token
 */
const generateAccessTokenAdmin = (adminId, role) => {
  return jwt.sign({ userId: adminId, role }, process.env.JWT_SECRET, {
    expiresIn: '24h',
  });
};

/**
 * Generate admin refresh token
 */
const generateRefreshTokenAdmin = (adminId) => {
  return jwt.sign({ userId: adminId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

/**
 * Generate a 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Calculate profile completion score (0-100)
 */
const calculateCompletionScore = (profile, family, prefs, photos, hobbies) => {
  let score = 0;

  // Basic (20 points)
  if (profile?.first_name) score += 4;
  if (profile?.date_of_birth) score += 4;
  if (profile?.location_city) score += 4;
  if (profile?.gender) score += 4;
  if (profile?.looking_for) score += 4;

  // Matrimony Core (20 points)
  if (profile?.denomination) score += 5;
  if (profile?.church_name) score += 5;
  if (profile?.faith_level) score += 5;
  if (profile?.marriage_intent) score += 5;

  // Personal (15 points)
  if (profile?.education) score += 5;
  if (profile?.profession) score += 5;
  if (profile?.annual_income_min) score += 5;

  // Lifestyle (10 points)
  if (profile?.smoking) score += 2.5;
  if (profile?.drinking) score += 2.5;
  if (profile?.diet) score += 2.5;
  if (profile?.gym) score += 2.5;

  // Family (10 points)
  if (family?.father_occupation) score += 3;
  if (family?.mother_occupation) score += 3;
  if (family?.family_class) score += 4;

  // Partner Preferences (10 points)
  if (prefs?.age_min && prefs?.age_max) score += 5;
  if (prefs?.preferred_locations?.length > 0) score += 5;

  // Photos (10 points)
  if (photos >= 1) score += 5;
  if (photos >= 3) score += 5;

  // Hobbies (5 points)
  if (hobbies >= 3) score += 5;

  return Math.min(Math.round(score), 100);
};

/**
 * Format phone number to E.164
 */
const formatPhoneNumber = (phone, countryCode = '+91') => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 10) return `${countryCode}${cleaned}`;
  return phone;
};

/**
 * Calculate age from date of birth
 */
const calculateAge = (dateOfBirth) => {
  const today = new Date();
  const dob = new Date(dateOfBirth);
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
  return age;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateAccessTokenAdmin,
  generateRefreshTokenAdmin,
  generateOTP,
  calculateCompletionScore,
  formatPhoneNumber,
  calculateAge,
  parsePgArray,
};
