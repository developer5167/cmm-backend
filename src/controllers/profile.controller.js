const { query } = require('../db');
const { recalculateCompletionScore, generateBio } = require('../services/onboarding.service');

// ─── GET My Profile ──────────────────────────────────────────
const getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [userRes, profileRes, familyRes, prefsRes, photosRes, hobbiesRes] = await Promise.all([
      query('SELECT id, phone_number, is_active, is_onboarding_complete FROM users WHERE id = $1', [userId]),
      query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
      query('SELECT * FROM user_family WHERE user_id = $1', [userId]),
      query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]),
      query('SELECT id, photo_url, is_primary, is_approved, order_index FROM user_photos WHERE user_id = $1 ORDER BY order_index', [userId]),
      query('SELECT h.id, h.name FROM user_hobbies uh JOIN hobbies h ON h.id = uh.hobby_id WHERE uh.user_id = $1', [userId]),
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        user: userRes.rows[0],
        profile: profileRes.rows[0] || null,
        family: familyRes.rows[0] || null,
        partner_preferences: prefsRes.rows[0] || null,
        photos: photosRes.rows,
        hobbies: hobbiesRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE Profile Data ──────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const fields = req.body; // Assuming validation middleware cleaned this up

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' });
    }

    const keys = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(fields)];

    const result = await query(
      `UPDATE user_profiles 
       SET ${setClauses}, updated_at = NOW() 
       WHERE user_id = $1 RETURNING *`,
      values
    );

    // Update bio automatically based on changes
    if (fields.first_name || fields.profession || fields.education || fields.denomination || fields.church_name || fields.location_city) {
      const bio = await generateBio(result.rows[0]);
      await query('UPDATE user_profiles SET bio = $1 WHERE user_id = $2', [bio, userId]);
      result.rows[0].bio = bio;
    }

    const score = await recalculateCompletionScore(userId);
    result.rows[0].profile_completion_score = score;

    res.json({ success: true, message: 'Profile updated successfully', data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE Family Data ───────────────────────────────────────
const updateFamily = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const fields = req.body;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' });
    }

    const keys = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(fields)];

    await query(
      `INSERT INTO user_family (user_id, ${keys.join(', ')})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      values
    );

    const score = await recalculateCompletionScore(userId);

    res.json({ success: true, message: 'Family details updated', data: { completion_score: score } });
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE Partner Preferences ───────────────────────────────
const updatePreferences = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const fields = req.body;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' });
    }

    const keys = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(fields)];

    await query(
      `INSERT INTO user_partner_preferences (user_id, ${keys.join(', ')})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      values
    );

    const score = await recalculateCompletionScore(userId);

    res.json({ success: true, message: 'Preferences updated', data: { completion_score: score } });
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE Settings / Privacy ────────────────────────────────
const updateSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { profile_visibility, who_can_chat, is_contact_sharing_allowed, is_images_locked } = req.body;

    const fields = Object.fromEntries(
      Object.entries({ profile_visibility, who_can_chat, is_contact_sharing_allowed, is_images_locked })
        .filter(([, v]) => v !== undefined)
    );

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' });
    }

    const keys = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(fields)];

    const result = await query(
      `UPDATE user_profiles SET ${setClauses}, updated_at = NOW() WHERE user_id = $1 RETURNING profile_visibility, who_can_chat, is_contact_sharing_allowed, is_images_locked`,
      values
    );

    res.json({ success: true, message: 'Privacy settings updated', data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── GET Public Profile (Viewed by Others) ────────────────────
const getPublicProfile = async (req, res, next) => {
  try {
    const viewerId = req.user.id;
    const viewedId = req.params.id;

    if (viewerId === viewedId) {
      return res.redirect('/api/v1/profile/me');
    }

    // 1. Check if blocked
    const blockCheck = await query(
      `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [viewerId, viewedId]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    // 2. Fetch basic profile data
    const profileRes = await query(
      `SELECT p.*, u.is_active, u.is_suspended 
       FROM user_profiles p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [viewedId]
    );

    if (profileRes.rows.length === 0 || !profileRes.rows[0].is_active || profileRes.rows[0].is_suspended) {
      return res.status(404).json({ success: false, message: 'Profile not found or inactive' });
    }

    const profile = profileRes.rows[0];

    // 3. Visibility Check
    // If hidden entirely
    if (profile.profile_visibility === 'hidden') {
      return res.status(403).json({ success: false, message: 'Profile is hidden' });
    }

    // Check interaction status
    const interactionCheck = await query(
      `SELECT status FROM interests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [viewerId, viewedId]
    );
    const hasInteraction = interactionCheck.rows.length > 0;
    const isAccepted = interactionCheck.rows.some(r => r.status === 'accepted');

    if (profile.profile_visibility === 'interests_only' && !hasInteraction) {
      return res.status(403).json({ success: false, message: 'Profile is private to interests only' });
    }

    // 4. Fetch the rest
    const [familyRes, prefsRes, photosRes, hobbiesRes] = await Promise.all([
      query('SELECT * FROM user_family WHERE user_id = $1', [viewedId]),
      query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [viewedId]),
      query('SELECT id, photo_url, is_primary, order_index FROM user_photos WHERE user_id = $1 AND is_approved = true ORDER BY order_index', [viewedId]),
      query('SELECT h.name FROM user_hobbies uh JOIN hobbies h ON h.id = uh.hobby_id WHERE uh.user_id = $1', [viewedId]),
    ]);

    // Handle Image Locking -> blur urls handled client side, or we return obfuscated urls
    let photos = photosRes.rows;
    const imagesLocked = profile.is_images_locked && !isAccepted;

    // Log profile view (fire and forget)
    query(
      `INSERT INTO profile_views (viewer_id, viewed_id) VALUES ($1, $2)`,
      [viewerId, viewedId]
    ).catch(e => console.error('Error logging profile view:', e));

    res.json({
      success: true,
      data: {
        profile: {
          first_name: profile.first_name,
          gender: profile.gender,
          date_of_birth: profile.date_of_birth,
          location_city: profile.location_city,
          location_state: profile.location_state,
          denomination: profile.denomination,
          church_name: profile.church_name,
          faith_level: profile.faith_level,
          church_involvement: profile.church_involvement,
          caste: profile.caste,
          education: profile.education,
          profession: profile.profession,
          height_cm: profile.height_cm,
          complexion: profile.complexion,
          native_place: profile.native_place,
          languages_spoken: profile.languages_spoken,
          marriage_timeline: profile.marriage_timeline,
          previously_married: profile.previously_married,
          smoking: profile.smoking,
          drinking: profile.drinking,
          diet: profile.diet,
          gym: profile.gym,
          bio: profile.bio,
          trust_badge: profile.trust_badge,
        },
        family: familyRes.rows[0] ? {
          father_occupation: familyRes.rows[0].father_occupation,
          mother_occupation: familyRes.rows[0].mother_occupation,
          brothers_count: familyRes.rows[0].brothers_count,
          sisters_count: familyRes.rows[0].sisters_count,
          family_class: familyRes.rows[0].family_class,
        } : null,
        partner_preferences: prefsRes.rows[0] || null,
        hobbies: hobbiesRes.rows.map(h => h.name),
        photos: photos.map(p => ({
          id: p.id,
          photo_url: p.photo_url,
          is_primary: p.is_primary,
          order_index: p.order_index,
        })),
        is_images_locked: imagesLocked,
        interaction_status: interactionCheck.rows[0]?.status || 'none',
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMyProfile,
  updateProfile,
  updateFamily,
  updatePreferences,
  updateSettings,
  getPublicProfile,
};
