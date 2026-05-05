const { query } = require('../db');
const { calculateCompatibility } = require('../services/matchmaking.service');
const { calculateAge, parsePgArray } = require('../utils/helpers');

/**
 * Helper to check daily limit
 */
const checkDailyLimit = async (userId) => {
  // Check subscription
  const subRes = await query(
    `SELECT p.features FROM subscriptions s
     JOIN subscription_plans p ON s.plan_id = p.id
     WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > NOW()`,
    [userId]
  );
  
  if (subRes.rows.length > 0 && subRes.rows[0].features?.unlimited_swipes) {
    return false; // No limit
  }

  // Count swipes today (interests sent + skips)
  const [interestCount, skipCount] = await Promise.all([
    query(`SELECT COUNT(*) FROM interests WHERE sender_id = $1 AND DATE(sent_at) = CURRENT_DATE`, [userId]),
    query(`SELECT COUNT(*) FROM skips WHERE user_id = $1 AND DATE(skipped_at) = CURRENT_DATE`, [userId]),
  ]);

  const totalSwipes = parseInt(interestCount.rows[0].count) + parseInt(skipCount.rows[0].count);
  return totalSwipes >= 20;
};

// ─── GET Discover Feed ─────────────────────────────────────────
// Optional session-level filter overrides via query params:
//   age_min, age_max, height_min, height_max, denominations (comma-sep),
//   location (city), caste_flexible, denomination_flexible, location_flexible,
//   profession_preference (pvt|govt|other|any — matches user_profiles.job_sector),
//   salary_min, salary_max (lakhs — converted to INR vs annual_income_*)
const getDiscoverFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // ── Session-level filter overrides from query params ─────────
    const qpAgeMin  = req.query.age_min    ? parseInt(req.query.age_min)    : null;
    const qpAgeMax  = req.query.age_max    ? parseInt(req.query.age_max)    : null;
    const qpHtMin   = req.query.height_min ? parseInt(req.query.height_min) : null;
    const qpHtMax   = req.query.height_max ? parseInt(req.query.height_max) : null;
    const qpDenoms  = req.query.denominations
      ? req.query.denominations.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const qpLoc     = req.query.location || null;
    const qpProf    = req.query.profession_preference || null; // any|pvt|govt|other
    const qpSalMin  = req.query.salary_min ? parseInt(req.query.salary_min) : null;
    const qpSalMax  = req.query.salary_max ? parseInt(req.query.salary_max) : null;
    const qpCasteFlexible  = req.query.caste_flexible  !== undefined
      ? req.query.caste_flexible === 'true' : null;
    const qpDenomFlexible  = req.query.denomination_flexible !== undefined
      ? req.query.denomination_flexible === 'true' : null;
    const qpLocFlexible    = req.query.location_flexible !== undefined
      ? req.query.location_flexible === 'true' : null;

    // Check limits
    const limitReached = await checkDailyLimit(userId);
    if (limitReached) {
      return res.json({
        success: true,
        message: 'Daily limit reached',
        data: { limit_reached: true, profiles: [] }
      });
    }

    // Get My Data
    const [myProfileRes, myPrefsRes] = await Promise.all([
      query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
      query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]),
    ]);

    const myProfile = myProfileRes.rows[0];
    const myPrefs = myPrefsRes.rows[0];

    if (myPrefs && myPrefs.preferred_denominations !== undefined) {
      myPrefs.preferred_denominations = parsePgArray(myPrefs.preferred_denominations);
    }

    if (!myProfile || !myProfile.gender || !myProfile.looking_for) {
      return res.status(400).json({ success: false, message: 'Please complete your basic profile first.' });
    }

    // Build Hard Filters SQL
    let whereClauses = [
      `p.user_id != $1`,
      `u.is_active = true`,
      `u.is_suspended = false`,
      `p.gender = $2`,
      `p.looking_for = $3`,
      `p.profile_visibility != 'hidden'`,
      `p.review_status = 'approved'`,
    ];
    let queryParams = [userId, myProfile.looking_for, myProfile.gender];
    let paramIndex = 4;

    // Filter out already interacted (sent interest, matched, blocked, skipped)
    whereClauses.push(`p.user_id NOT IN (
      SELECT receiver_id FROM interests WHERE sender_id = $1
      UNION
      SELECT sender_id FROM interests WHERE receiver_id = $1
      UNION
      SELECT blocked_id FROM blocks WHERE blocker_id = $1
      UNION
      SELECT blocker_id FROM blocks WHERE blocked_id = $1
      UNION
      SELECT skipped_user_id FROM skips WHERE user_id = $1
    )`);

    // ── Apply filters: query param overrides take precedence ─────
    const ageMin  = qpAgeMin  ?? myPrefs?.age_min;
    const ageMax  = qpAgeMax  ?? myPrefs?.age_max;
    const htMin   = qpHtMin   ?? myPrefs?.height_min;
    const htMax   = qpHtMax   ?? myPrefs?.height_max;
    const denomFlexible = qpDenomFlexible  ?? myPrefs?.denomination_flexible ?? false;
    const locFlexible   = qpLocFlexible    ?? myPrefs?.location_flexible ?? false;
    const casteFlexible = qpCasteFlexible  ?? myPrefs?.caste_flexible ?? false;
    const profPref = qpProf ?? myPrefs?.profession_preference ?? 'any';
    const salMin   = qpSalMin ?? myPrefs?.salary_min;
    const salMax   = qpSalMax ?? myPrefs?.salary_max;

    const denomList = qpDenoms ?? myPrefs?.preferred_denominations ?? [];
    const locList   = qpLoc ? [qpLoc] : (myPrefs?.preferred_locations ?? []);

    if (ageMin) {
      whereClauses.push(`EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth)) >= $${paramIndex++}`);
      queryParams.push(ageMin);
    }
    if (ageMax) {
      whereClauses.push(`EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth)) <= $${paramIndex++}`);
      queryParams.push(ageMax);
    }
    if (htMin) {
      whereClauses.push(`p.height_cm >= $${paramIndex++}`);
      queryParams.push(htMin);
    }
    if (htMax) {
      whereClauses.push(`p.height_cm <= $${paramIndex++}`);
      queryParams.push(htMax);
    }
    if (!locFlexible && locList.length > 0) {
      whereClauses.push(`p.location_city = ANY($${paramIndex++})`);
      queryParams.push(locList);
    }
    if (!denomFlexible && denomList.length > 0) {
      whereClauses.push(`p.denomination = ANY($${paramIndex++})`);
      queryParams.push(denomList);
    }
    if (!casteFlexible && myPrefs?.preferred_castes?.length > 0) {
      whereClauses.push(`p.caste = ANY($${paramIndex++})`);
      queryParams.push(myPrefs.preferred_castes);
    }
    if (profPref && profPref !== 'any') {
      whereClauses.push(`p.job_sector = $${paramIndex++}`);
      queryParams.push(profPref);
    }
    // Partner prefs & query params use lakhs; profile columns are INR.
    const LAKH = 100000;
    if (salMin != null && salMin > 0) {
      whereClauses.push(`COALESCE(p.annual_income_max, p.annual_income_min, 0) >= $${paramIndex++}`);
      queryParams.push(salMin * LAKH);
    }
    if (salMax != null && salMax < 100) {
      whereClauses.push(`COALESCE(p.annual_income_min, p.annual_income_max, 2147483647) <= $${paramIndex++}`);
      queryParams.push(salMax * LAKH);
    }

    // Fetch Candidates (fetch more than limit to sort by compatibility)
    const sql = `
      SELECT p.*, f.family_class,
        (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.photo_url, 'is_primary', ph.is_primary)) 
         FROM user_photos ph WHERE ph.user_id = p.user_id AND ph.is_approved = true) as photos,
        CASE WHEN sb.ends_at > NOW() THEN 1 ELSE 0 END as is_spotlighted
      FROM user_profiles p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN user_family f ON p.user_id = f.user_id
      LEFT JOIN spotlight_boosts sb ON sb.user_id = p.user_id AND sb.ends_at > NOW()
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY is_spotlighted DESC, p.profile_completion_score DESC
      LIMIT 20 OFFSET $${paramIndex}
    `;

    queryParams.push(offset); // For pagination chunks

    const candidatesRes = await query(sql, queryParams);

    if (candidatesRes.rows.length === 0) {
      return res.json({ success: true, data: { limit_reached: false, profiles: [] } });
    }

    // Calculate Compatibility in JS
    let profiles = candidatesRes.rows.map(candidate => {
      const compatibility_score = calculateCompatibility(myProfile, myPrefs, candidate, { family_class: candidate.family_class });
      candidate.age = calculateAge(candidate.date_of_birth);
      candidate.compatibility = Math.round(compatibility_score); 
      candidate.name = candidate.first_name; 
      candidate.city = candidate.location_city; 
      
      // CRITICAL: Set id to user_id for frontend navigation
      candidate.id = candidate.user_id;
      
      // Clean up fields
      delete candidate.latitude;
      delete candidate.longitude;
      
      return candidate;
    });

    // Sort by Spotlight first, then Compatibility
    profiles.sort((a, b) => {
      if (a.is_spotlighted !== b.is_spotlighted) return b.is_spotlighted - a.is_spotlighted;
      return b.compatibility_score - a.compatibility_score;
    });

    // Paginate in memory out of the 100 fetched
    profiles = profiles.slice(0, limit);

    res.json({
      success: true,
      data: {
        limit_reached: false,
        profiles,
      }
    });

  } catch (err) {
    next(err);
  }
};

// ─── GET Daily Curated Matches ────────────────────────────────
// Returns up to 5 top-compatibility profiles for today.
// Results are stable for the day (seeded by today's date so they
// don't shuffle on every request).
const getDailyMatches = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [myProfileRes, myPrefsRes] = await Promise.all([
      query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
      query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]),
    ]);

    const myProfile = myProfileRes.rows[0];
    const myPrefs   = myPrefsRes.rows[0];

    if (!myProfile || !myProfile.gender || !myProfile.looking_for) {
      return res.json({ success: true, data: { matches: [] } });
    }

    if (myPrefs?.preferred_denominations !== undefined) {
      myPrefs.preferred_denominations = parsePgArray(myPrefs.preferred_denominations);
    }

    // Fetch a broader candidate pool, sorted by completion score
    const sql = `
      SELECT p.user_id, p.first_name, p.date_of_birth, p.profession,
             p.denomination, p.faith_level, p.smoking, p.drinking, p.diet,
             p.marriage_intent, p.marriage_timeline, p.location_city,
             p.annual_income_max, p.education, p.profile_completion_score,
             f.family_class,
             (SELECT ph.photo_url FROM user_photos ph
              WHERE ph.user_id = p.user_id AND ph.is_primary = true AND ph.is_approved = true
              LIMIT 1) AS primary_photo,
             CASE WHEN sb.ends_at > NOW() THEN 1 ELSE 0 END AS is_spotlighted
        FROM user_profiles p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN user_family f ON p.user_id = f.user_id
        LEFT JOIN spotlight_boosts sb ON sb.user_id = p.user_id AND sb.ends_at > NOW()
       WHERE p.user_id != $1
         AND u.is_active = true
         AND u.is_suspended = false
         AND p.gender = $2
         AND p.looking_for = $3
         AND p.profile_visibility != 'hidden'
         AND p.review_status = 'approved'
         AND p.user_id NOT IN (
           SELECT receiver_id FROM interests WHERE sender_id = $1
           UNION SELECT sender_id FROM interests WHERE receiver_id = $1
           UNION SELECT blocked_id FROM blocks WHERE blocker_id = $1
           UNION SELECT blocker_id FROM blocks WHERE blocked_id = $1
           UNION SELECT skipped_user_id FROM skips WHERE user_id = $1
         )
       ORDER BY p.profile_completion_score DESC
       LIMIT 50
    `;

    const candidatesRes = await query(sql, [userId, myProfile.looking_for, myProfile.gender]);

    if (candidatesRes.rows.length === 0) {
      return res.json({ success: true, data: { matches: [] } });
    }

    // Score and sort by compatibility
    let profiles = candidatesRes.rows.map(candidate => {
      const score = calculateCompatibility(myProfile, myPrefs, candidate, { family_class: candidate.family_class });
      candidate.compatibility = Math.round(score);
      candidate.age = calculateAge(candidate.date_of_birth);
      candidate.id = candidate.user_id;
      return candidate;
    });

    profiles.sort((a, b) => b.compatibility - a.compatibility);

    // Return top 5 — stable for the day using a date-seeded slice
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seed  = (parseInt(today) + parseInt(userId.replace(/-/g, '').slice(0, 8), 16)) % (profiles.length || 1);
    const start = seed % Math.max(1, profiles.length - 5);
    const top   = profiles.slice(0, 5); // just take top 5 by compatibility

    res.json({ success: true, data: { matches: top } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDiscoverFeed,
  getDailyMatches,
};
