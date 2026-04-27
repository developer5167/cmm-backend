const { query } = require('../db');
const { calculateCompatibility } = require('../services/matchmaking.service');
const { calculateAge } = require('../utils/helpers');

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
    query(`SELECT COUNT(*) FROM behavioral_signals WHERE user_id = $1 AND action = 'skipped' AND DATE(created_at) = CURRENT_DATE`, [userId]),
  ]);

  const totalSwipes = parseInt(interestCount.rows[0].count) + parseInt(skipCount.rows[0].count);
  return totalSwipes >= 20;
};

// ─── GET Discover Feed ─────────────────────────────────────────
const getDiscoverFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

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

    if (!myProfile || !myProfile.gender || !myProfile.looking_for) {
      return res.status(400).json({ success: false, message: 'Please complete your basic profile first.' });
    }

    // Build Hard Filters SQL
    let whereClauses = [
      `p.user_id != $1`, // Not me
      `u.is_active = true`,
      `u.is_suspended = false`,
      `p.gender = $2`, // They are what I'm looking for
      `p.looking_for = $3`, // I am what they are looking for
      `p.profile_visibility != 'hidden'`, // Not hidden
    ];
    let queryParams = [userId, myProfile.looking_for, myProfile.gender];
    let paramIndex = 4;

    // Filter out already interacted (sent interest, blocked, skipped recently)
    whereClauses.push(`p.user_id NOT IN (
      SELECT receiver_id FROM interests WHERE sender_id = $1
      UNION
      SELECT blocked_id FROM blocks WHERE blocker_id = $1
      UNION
      SELECT blocker_id FROM blocks WHERE blocked_id = $1
      UNION
      SELECT target_user_id FROM behavioral_signals WHERE user_id = $1 AND action = 'skipped' AND created_at > NOW() - INTERVAL '30 days'
    )`);

    // Apply Prefs Hard Filters
    if (myPrefs) {
      if (myPrefs.age_min) {
        whereClauses.push(`EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth)) >= $${paramIndex++}`);
        queryParams.push(myPrefs.age_min);
      }
      if (myPrefs.age_max) {
        whereClauses.push(`EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth)) <= $${paramIndex++}`);
        queryParams.push(myPrefs.age_max);
      }

      if (!myPrefs.location_flexible && myPrefs.preferred_locations?.length > 0) {
        whereClauses.push(`p.location_city = ANY($${paramIndex++})`);
        queryParams.push(myPrefs.preferred_locations);
      }

      if (!myPrefs.denomination_flexible && myPrefs.preferred_denominations?.length > 0) {
        whereClauses.push(`p.denomination = ANY($${paramIndex++})`);
        queryParams.push(myPrefs.preferred_denominations);
      }

      if (!myPrefs.caste_flexible && myPrefs.preferred_castes?.length > 0) {
        whereClauses.push(`p.caste = ANY($${paramIndex++})`);
        queryParams.push(myPrefs.preferred_castes);
      }
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
      LIMIT 100 OFFSET $${paramIndex}
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
      candidate.compatibility_score = compatibility_score;
      
      // Clean up fields
      delete candidate.family_class;
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

module.exports = {
  getDiscoverFeed,
};
