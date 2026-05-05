const { query } = require('../db');
const { recalculateCompletionScore, generateBio } = require('../services/onboarding.service');
const { parsePgArray } = require('../utils/helpers');
const { sendPushToUser } = require('../services/fcm.service');

const SENSITIVE_FIELDS = [
  'first_name', 'last_name', 'church_name', 'caste', 
  'education', 'profession', 'bio', 'native_place',
  'special_needs_details'
];

// ─── GET My Profile ──────────────────────────────────────────
const getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [userRes, profileRes, familyRes, prefsRes, photosRes, hobbiesRes, subRes] = await Promise.all([
      query(`SELECT u.id, u.phone_number, u.is_active, u.is_onboarding_complete, p.review_status 
             FROM users u 
             LEFT JOIN user_profiles p ON u.id = p.user_id 
             WHERE u.id = $1`, [userId]),
      query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
      query('SELECT * FROM user_family WHERE user_id = $1', [userId]),
      query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]),
      query('SELECT id, photo_url, is_primary, is_approved, review_status, rejection_reason, order_index FROM user_photos WHERE user_id = $1 ORDER BY order_index', [userId]),
      query('SELECT h.id, h.name FROM user_hobbies uh JOIN hobbies h ON h.id = uh.hobby_id WHERE uh.user_id = $1', [userId]),
      query(
        `SELECT sp.name AS plan_name, s.expires_at
           FROM subscriptions s
           JOIN subscription_plans sp ON sp.id = s.plan_id
          WHERE s.user_id = $1
            AND s.status = 'active'
            AND s.expires_at > NOW()
          ORDER BY s.expires_at DESC
          LIMIT 1`,
        [userId]
      ),
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const partnerPrefs = prefsRes.rows[0] || null;
    if (partnerPrefs && partnerPrefs.preferred_denominations !== undefined) {
      partnerPrefs.preferred_denominations = parsePgArray(partnerPrefs.preferred_denominations);
    }

    res.json({
      success: true,
      data: {
        user: userRes.rows[0],
        profile: profileRes.rows[0] || null,
        family: familyRes.rows[0] || null,
        partner_preferences: partnerPrefs,
        photos: photosRes.rows,
        hobbies: hobbiesRes.rows,
        subscription: subRes.rows[0]
          ? {
              is_premium: true,
              plan_name: subRes.rows[0].plan_name,
              expires_at: subRes.rows[0].expires_at,
            }
          : {
              is_premium: false,
              plan_name: null,
              expires_at: null,
            },
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
    const fields = req.body;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' });
    }

    // Check if user is already onboarding complete
    const userCheck = await query('SELECT is_onboarding_complete FROM users WHERE id = $1', [userId]);
    const isOnboardingComplete = userCheck.rows[0]?.is_onboarding_complete;

    const profileRes = await query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
    const currentProfile = profileRes.rows[0] || {};

    const updateFields = {};
    const revisionFields = {};

    for (const [key, value] of Object.entries(fields)) {
      if (SENSITIVE_FIELDS.includes(key) && isOnboardingComplete && currentProfile[key] !== value) {
        revisionFields[key] = value;
      } else {
        updateFields[key] = value;
      }
    }

    // 1. Update non-sensitive fields immediately
    let updatedProfile = currentProfile;
    if (Object.keys(updateFields).length > 0) {
      const keys = Object.keys(updateFields);
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const values = [userId, ...Object.values(updateFields)];

      const result = await query(
        `UPDATE user_profiles 
         SET ${setClauses}, updated_at = NOW() 
         WHERE user_id = $1 RETURNING *`,
        values
      );
      updatedProfile = result.rows[0];
    }

    // 2. Create revisions for sensitive fields
    const createdRevisions = [];
    if (Object.keys(revisionFields).length > 0) {
      for (const [field, newValue] of Object.entries(revisionFields)) {
        const revResult = await query(
          `INSERT INTO profile_revisions (user_id, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [userId, field, currentProfile[field], newValue]
        );
        createdRevisions.push(revResult.rows[0]);
      }
    }

    // Update bio automatically based on changes (only for fields that were updated)
    if (updateFields.first_name || updateFields.profession || updateFields.education || updateFields.denomination || updateFields.church_name || updateFields.location_city) {
      const bio = await generateBio(updatedProfile);
      await query('UPDATE user_profiles SET bio = $1 WHERE user_id = $2', [bio, userId]);
      updatedProfile.bio = bio;
    }

    const score = await recalculateCompletionScore(userId);
    updatedProfile.profile_completion_score = score;

    res.json({ 
      success: true, 
      message: createdRevisions.length > 0 
        ? 'Some changes are pending admin review' 
        : 'Profile updated successfully', 
      data: updatedProfile,
      revisions_pending: createdRevisions.length
    });
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

    const userCheck = await query('SELECT is_onboarding_complete FROM users WHERE id = $1', [userId]);
    const isOnboardingComplete = userCheck.rows[0]?.is_onboarding_complete;

    const prefsRes = await query('SELECT * FROM user_partner_preferences WHERE user_id = $1', [userId]);
    const currentPrefs = prefsRes.rows[0] || {};

    const updateFields = {};
    const revisionFields = {};
    const sensitivePrefs = ['education_preference', 'profession_preference'];

    for (const [key, value] of Object.entries(fields)) {
      if (sensitivePrefs.includes(key) && isOnboardingComplete && currentPrefs[key] !== value) {
        revisionFields[key] = value;
      } else {
        updateFields[key] = value;
      }
    }

    // 1. Update non-sensitive fields
    if (Object.keys(updateFields).length > 0) {
      const keys = Object.keys(updateFields);
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const values = [userId, ...Object.values(updateFields)];

      await query(
        `INSERT INTO user_partner_preferences (user_id, ${keys.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
        values
      );
    }

    // 2. Create revisions
    const createdRevisions = [];
    if (Object.keys(revisionFields).length > 0) {
      for (const [field, newValue] of Object.entries(revisionFields)) {
        const revResult = await query(
          `INSERT INTO profile_revisions (user_id, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [userId, field, currentPrefs[field], newValue]
        );
        createdRevisions.push(revResult.rows[0]);
      }
    }

    const score = await recalculateCompletionScore(userId);

    res.json({ 
      success: true, 
      message: createdRevisions.length > 0 ? 'Some changes are pending review' : 'Preferences updated', 
      data: { completion_score: score },
      revisions_pending: createdRevisions.length
    });
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE Settings / Privacy ────────────────────────────────
const coerceBool = (v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return Boolean(v);
};

const updateSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { profile_visibility, who_can_chat, is_contact_sharing_allowed, is_images_locked } = req.body;

    const fields = Object.fromEntries(
      Object.entries({
        profile_visibility,
        who_can_chat,
        is_contact_sharing_allowed: coerceBool(is_contact_sharing_allowed),
        is_images_locked: coerceBool(is_images_locked),
      }).filter(([, v]) => v !== undefined && v !== null)
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
      `SELECT p.*, u.is_active, u.is_suspended, p.review_status 
       FROM user_profiles p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [viewedId]
    );

    if (profileRes.rows.length === 0 || profileRes.rows[0].is_suspended) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const profile = profileRes.rows[0];
    
    // Allow viewing if active OR approved OR under review (for discovery)
    if (!profile.is_active && profile.review_status === 'rejected') {
      return res.status(404).json({ success: false, message: 'Profile inactive' });
    }

    // 3. Visibility Check
    // If hidden entirely
    if (profile.profile_visibility === 'hidden') {
      return res.status(403).json({ success: false, message: 'Profile is hidden' });
    }

    // Check interaction status — include id, sender_id, and conversation_id
    const interactionCheck = await query(
      `SELECT i.id, i.status, i.sender_id,
              c.id AS conversation_id
       FROM interests i
       LEFT JOIN conversations c ON c.interest_id = i.id
       WHERE (i.sender_id = $1 AND i.receiver_id = $2)
          OR (i.sender_id = $2 AND i.receiver_id = $1)
       LIMIT 1`,
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

    // Embed contact_status for accepted matches — eliminates a separate API round-trip.
    // Returns the same shape as GET /premium/contact-status/:id so the client needs
    // no format conversion.
    let contactStatus = null;
    if (isAccepted) {
      const [outRes, inRes] = await Promise.all([
        query(
          `SELECT id, status, responded_at FROM contact_requests
           WHERE requester_id = $1 AND target_user_id = $2
           ORDER BY requested_at DESC LIMIT 1`,
          [viewerId, viewedId]
        ),
        query(
          `SELECT id, status FROM contact_requests
           WHERE requester_id = $1 AND target_user_id = $2
           ORDER BY requested_at DESC LIMIT 1`,
          [viewedId, viewerId]
        ),
      ]);
      const outRow = outRes.rows[0] ?? null;
      const inRow  = inRes.rows[0]  ?? null;

      let phone = null;
      if (outRow?.status === 'approved') {
        const phoneRes = await query(
          `SELECT phone_number FROM users WHERE id = $1`, [viewedId]
        );
        phone = phoneRes.rows[0]?.phone_number ?? null;
      }

      contactStatus = {
        outgoing: outRow ? { id: outRow.id, status: outRow.status, responded_at: outRow.responded_at } : null,
        incoming: inRow  ? { id: inRow.id,  status: inRow.status  } : null,
        phone,
      };
    }

    // Log profile view (fire and forget). Send push only on first-ever view
    // from this viewer to this target (prevents spam on repeated opens).
    (async () => {
      try {
        const existsRes = await query(
          `SELECT 1
             FROM profile_views
            WHERE viewer_id = $1 AND viewed_id = $2
            LIMIT 1`,
          [viewerId, viewedId]
        );
        const isFirstView = existsRes.rows.length === 0;

        await query(
          `INSERT INTO profile_views (viewer_id, viewed_id) VALUES ($1, $2)`,
          [viewerId, viewedId]
        );

        if (!isFirstView) return;

        const viewerProfile = await query(
          `SELECT first_name FROM user_profiles WHERE user_id = $1`,
          [viewerId]
        );
        const fname = viewerProfile.rows[0]?.first_name || 'Someone';

        await query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'profile_viewed', $2, $3, $4)`,
          [
            viewedId,
            'Someone viewed your profile 👀',
            `${fname} viewed your profile.`,
            JSON.stringify({ actor_id: viewerId }),
          ]
        );

        await sendPushToUser(
          viewedId,
          {
            title: 'New profile view 👀',
            body: `${fname} viewed your profile.`,
          },
          {
            type: 'profile_viewed',
            actor_id: viewerId,
          }
        );
      } catch (e) {
        console.error('Error logging profile view:', e.message);
      }
    })();

    res.json({
      success: true,
      data: {
        profile: {
          ...profile, // Return all fields from user_profiles safely
          id: undefined, // Hide internal PK
          user_id: undefined, // Hide internal FK
        },
        family: familyRes.rows[0] ? {
          ...familyRes.rows[0],
          id: undefined,
          user_id: undefined,
        } : null,
        partner_preferences: (() => {
          const p = prefsRes.rows[0] || null;
          if (p && p.preferred_denominations !== undefined) {
            p.preferred_denominations = parsePgArray(p.preferred_denominations);
          }
          return p;
        })(),
        hobbies: hobbiesRes.rows.map(h => h.name),
        photos: photos.map(p => ({
          id: p.id,
          photo_url: p.photo_url,
          is_primary: p.is_primary,
          order_index: p.order_index,
        })),
        is_images_locked: imagesLocked,
        interaction_status: interactionCheck.rows[0]?.status || 'none',
        interaction_sender_id: interactionCheck.rows[0]?.sender_id || null,
        interest_id: interactionCheck.rows[0]?.id || null,
        conversation_id: interactionCheck.rows[0]?.conversation_id || null,
        contact_status: contactStatus, // null when not accepted; embedded to avoid extra call
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
