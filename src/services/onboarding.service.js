/**
 * Onboarding Service – GraceMatch
 * Handles profile completion scoring and AI bio generation
 */

const { query } = require('../db');
const { generateProfileSummary } = require('./ai.service');

/**
 * Calculate profile completion score (0–100)
 * Called after each onboarding step save
 */
const recalculateCompletionScore = async (userId) => {
  // Fetch all related data
  const [profileRes, familyRes, prefsRes, photosRes, hobbiesRes] = await Promise.all([
    query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
    query('SELECT * FROM user_family WHERE user_id = $1', [userId]),
    query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]),
    query('SELECT COUNT(*) FROM user_photos WHERE user_id = $1 AND is_approved = true', [userId]),
    query('SELECT COUNT(*) FROM user_hobbies WHERE user_id = $1', [userId]),
  ]);

  const p = profileRes.rows[0] || {};
  const fam = familyRes.rows[0] || {};
  const pref = prefsRes.rows[0] || {};
  const photoCount = parseInt(photosRes.rows[0].count);
  const hobbyCount = parseInt(hobbiesRes.rows[0].count);

  let score = 0;

  // Step 1 – Basic (20 pts)
  if (p.first_name) score += 4;
  if (p.date_of_birth) score += 4;
  if (p.location_city) score += 4;
  if (p.gender) score += 4;
  if (p.looking_for) score += 4;

  // Step 2 – Matrimony Core (20 pts)
  if (p.denomination) score += 5;
  if (p.church_name) score += 5;
  if (p.faith_level) score += 5;
  if (p.marriage_intent) score += 5;

  // Step 3 – Personal (15 pts)
  if (p.education) score += 5;
  if (p.profession) score += 5;
  if (p.annual_income_min) score += 5;

  // Step 4 – Lifestyle (8 pts)
  if (p.smoking) score += 2;
  if (p.drinking) score += 2;
  if (p.diet) score += 2;
  if (p.gym) score += 2;

  // Step 5 – Family (7 pts)
  if (fam.father_occupation) score += 2;
  if (fam.mother_occupation) score += 2;
  if (fam.family_class) score += 3;

  // Step 6 – Partner Preferences (10 pts)
  if (pref.age_min && pref.age_max) score += 5;
  if (pref.preferred_locations?.length > 0 || pref.location_flexible) score += 5;

  // Step 7 – Hobbies (5 pts)
  if (hobbyCount >= 3) score += 5;
  else if (hobbyCount >= 1) score += 2;

  // Step 8 – Photos (10 pts)
  if (photoCount >= 1) score += 5;
  if (photoCount >= 3) score += 5;

  // Step 9 – Verification (2 pts)
  const verRes = await query('SELECT is_id_verified FROM user_verification WHERE user_id = $1', [userId]);
  if (verRes.rows[0]?.is_id_verified) score += 2;

  // Step 10 – Profile managed by (3 pts)
  if (p.profile_managed_by) score += 3;

  score = Math.min(Math.round(score), 100);

  // Compute trust badge (must have: verified ID + selfie + church_name)
  const verRow = verRes.rows[0] || {};
  const trustBadge = !!(verRow.is_id_verified && p.church_name && p.denomination);

  // Save score
  await query(
    `UPDATE user_profiles
     SET profile_completion_score = $1, trust_badge = $2, updated_at = NOW()
     WHERE user_id = $3`,
    [score, trustBadge, userId]
  );

  return score;
};

/**
 * Generate a smart AI bio from profile data
 * Integrates directly with our ai.service
 */
const generateBio = async (profile) => {
  try {
    return await generateProfileSummary(profile);
  } catch (err) {
    console.error("AI Bio Error:", err);
    return "GraceMatch member looking for a life partner.";
  }
};

/**
 * Get full onboarding status for a user
 */
const getOnboardingStatus = async (userId) => {
  const [userRes, profileRes, familyRes, prefsRes, photosRes, hobbiesRes] = await Promise.all([
    query('SELECT onboarding_step, is_onboarding_complete FROM users WHERE id = $1', [userId]),
    query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
    query('SELECT * FROM user_family WHERE user_id = $1', [userId]),
    query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]),
    query('SELECT id, photo_url, is_primary, order_index FROM user_photos WHERE user_id = $1 ORDER BY order_index', [userId]),
    query(`SELECT h.id, h.name FROM user_hobbies uh
           JOIN hobbies h ON h.id = uh.hobby_id
           WHERE uh.user_id = $1`, [userId]),
  ]);

  return {
    current_step: userRes.rows[0]?.onboarding_step || 0,
    is_complete: userRes.rows[0]?.is_onboarding_complete || false,
    profile: profileRes.rows[0] || null,
    family: familyRes.rows[0] || null,
    partner_preferences: prefsRes.rows[0] || null,
    photos: photosRes.rows,
    hobbies: hobbiesRes.rows,
  };
};

module.exports = { recalculateCompletionScore, generateBio, getOnboardingStatus };
