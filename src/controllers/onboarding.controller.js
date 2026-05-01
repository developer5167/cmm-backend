/**
 * Onboarding Controller – GraceMatch
 *
 * Steps:
 *   GET  /api/v1/onboarding/status   → current step + saved data
 *   GET  /api/v1/onboarding/hobbies  → master hobbies list
 *   POST /api/v1/onboarding/step/1   → Basic info
 *   POST /api/v1/onboarding/step/2   → Matrimony core
 *   POST /api/v1/onboarding/step/3   → Personal
 *   POST /api/v1/onboarding/step/4   → Lifestyle
 *   POST /api/v1/onboarding/step/5   → Family
 *   POST /api/v1/onboarding/step/6   → Partner preferences
 *   POST /api/v1/onboarding/step/7   → Hobbies
 *   POST /api/v1/onboarding/step/8   → Photos (upload)
 *   DELETE /api/v1/onboarding/photos/:photoId → Delete photo
 *   POST /api/v1/onboarding/step/9   → Verification (optional govt ID)
 *   POST /api/v1/onboarding/step/10  → Profile managed by + finalize
 */

const { query } = require('../db');
const { uploadFile, deleteFile } = require('../services/storage.service');
const { recalculateCompletionScore, generateBio, getOnboardingStatus } = require('../services/onboarding.service');

// ─── Helpers ─────────────────────────────────────────────────

const upsertProfile = async (userId, fields) => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;

  // Build SET clause dynamically
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [userId, ...keys.map((k) => fields[k])];

  await query(
    `INSERT INTO user_profiles (user_id, ${keys.join(', ')})
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    values
  );
};

const advanceStep = async (userId, step) => {
  await query(
    `UPDATE users SET onboarding_step = GREATEST(onboarding_step, $2), updated_at = NOW()
     WHERE id = $1`,
    [userId, step]
  );
};

// ─── GET /onboarding/status ───────────────────────────────────
const getStatus = async (req, res, next) => {
  try {
    const status = await getOnboardingStatus(req.user.id);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
};

// ─── GET /onboarding/hobbies ──────────────────────────────────
const getHobbies = async (req, res, next) => {
  try {
    const result = await query('SELECT id, name FROM hobbies ORDER BY name');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 1: Basic Info ───────────────────────────────────────
const step1 = async (req, res, next) => {
  try {
    const { gender, looking_for, first_name, last_name, date_of_birth, location_city, location_state, location_country, latitude, longitude } = req.body;
    const userId = req.user.id;

    await upsertProfile(userId, {
      gender, looking_for, first_name, last_name,
      date_of_birth, location_city,
      ...(location_state && { location_state }),
      ...(location_country && { location_country }),
      ...(latitude && { latitude }),
      ...(longitude && { longitude }),
    });

    await advanceStep(userId, 1);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Basic info saved',
      data: { completion_score: score, next_step: 2 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 2: Matrimony Core ───────────────────────────────────
const step2 = async (req, res, next) => {
  try {
    const { marriage_intent, denomination, church_name, faith_level, church_involvement, caste } = req.body;
    const userId = req.user.id;

    await upsertProfile(userId, {
      marriage_intent, denomination,
      ...(church_name && { church_name }),
      ...(faith_level && { faith_level }),
      ...(church_involvement && { church_involvement }),
      ...(caste && { caste }),
    });

    await advanceStep(userId, 2);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Matrimony core saved',
      data: { completion_score: score, next_step: 3 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 3: Personal ────────────────────────────────────────
const step3 = async (req, res, next) => {
  try {
    const { education, profession, job_sector, annual_income_min, annual_income_max, height_cm, complexion, native_place, languages_spoken, previously_married, marriage_timeline } = req.body;
    const userId = req.user.id;

    await upsertProfile(userId, {
      ...(education && { education }),
      ...(profession && { profession }),
      ...(job_sector && { job_sector }),
      ...(annual_income_min && { annual_income_min }),
      ...(annual_income_max && { annual_income_max }),
      ...(height_cm && { height_cm }),
      ...(complexion && { complexion }),
      ...(native_place && { native_place }),
      ...(languages_spoken && { languages_spoken }),
      ...(previously_married && { previously_married }),
      ...(marriage_timeline && { marriage_timeline }),
      ...(req.body.bio && { bio: req.body.bio }),
    });

    await advanceStep(userId, 3);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Personal info saved',
      data: { completion_score: score, next_step: 4 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 4: Lifestyle ───────────────────────────────────────
const step4 = async (req, res, next) => {
  try {
    const { smoking, drinking, diet, gym } = req.body;
    const userId = req.user.id;

    await upsertProfile(userId, {
      ...(smoking && { smoking }),
      ...(drinking && { drinking }),
      ...(diet && { diet }),
      ...(gym && { gym }),
    });

    await advanceStep(userId, 4);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Lifestyle saved',
      data: { completion_score: score, next_step: 5 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 5: Family ──────────────────────────────────────────
const step5 = async (req, res, next) => {
  try {
    const { 
      family_type, father_occupation, mother_occupation, 
      brothers_count, sisters_count, married_brothers_count, 
      married_sisters_count, family_income_range, family_class,
      sibling_details 
    } = req.body;
    const userId = req.user.id;

    const fields = Object.fromEntries(
      Object.entries({
        family_type, father_occupation, mother_occupation, brothers_count, sisters_count,
        married_brothers_count, married_sisters_count, family_income_range, family_class,
        sibling_details: sibling_details ? JSON.stringify(sibling_details) : undefined,
      }).filter(([, v]) => v !== undefined && v !== null)
    );

    const keys = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(fields)];

    await query(
      `INSERT INTO user_family (user_id, ${keys.join(', ')})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      values
    );

    await advanceStep(userId, 5);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Family info saved',
      data: { completion_score: score, next_step: 6 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 6: Partner Preferences ─────────────────────────────
const step6 = async (req, res, next) => {
  try {
    const { age_min, age_max, height_min, height_max, location_flexible, preferred_locations, denomination_flexible, preferred_denominations, caste_flexible, preferred_castes, education_preference, profession_preference, salary_min, salary_max } = req.body;
    const userId = req.user.id;

    const fields = Object.fromEntries(
      Object.entries({
        age_min, age_max, height_min, height_max,
        location_flexible, preferred_locations,
        denomination_flexible, preferred_denominations,
        caste_flexible, preferred_castes,
        education_preference, profession_preference,
        salary_min, salary_max,
      }).filter(([, v]) => v !== undefined && v !== null)
    );

    const keys = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(fields)];

    await query(
      `INSERT INTO user_partner_preferences (user_id, ${keys.join(', ')})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      values
    );

    await advanceStep(userId, 6);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Partner preferences saved',
      data: { completion_score: score, next_step: 7 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 7: Hobbies ─────────────────────────────────────────
const step7 = async (req, res, next) => {
  try {
    const { hobby_ids } = req.body; // array of hobby integer IDs
    const userId = req.user.id;

    // Validate hobby IDs exist
    const validResult = await query('SELECT id FROM hobbies WHERE id = ANY($1)', [hobby_ids]);
    const validIds = validResult.rows.map((r) => r.id);

    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid hobby IDs provided' });
    }

    // Delete existing and re-insert (clean replace)
    await query('DELETE FROM user_hobbies WHERE user_id = $1', [userId]);

    const insertValues = validIds.map((id, i) => `($1, $${i + 2})`).join(', ');
    await query(
      `INSERT INTO user_hobbies (user_id, hobby_id) VALUES ${insertValues}`,
      [userId, ...validIds]
    );

    await advanceStep(userId, 7);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: 'Hobbies saved',
      data: { completion_score: score, hobby_count: validIds.length, next_step: 8 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 8: Photos ──────────────────────────────────────────
const step8 = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const files = req.files; // array from multer

    // Check existing photo count
    const existingRes = await query(
      'SELECT COUNT(*) FROM user_photos WHERE user_id = $1',
      [userId]
    );
    const existingCount = parseInt(existingRes.rows[0].count);

    if ((!files || files.length === 0) && existingCount === 0) {
      return res.status(400).json({ success: false, message: 'At least one photo is required' });
    }

    if (files && files.length > 0 && existingCount + files.length > 6) {
      return res.status(400).json({ success: false, message: 'Maximum 6 photos allowed' });
    }

    const uploaded = [];

    const fileList = files || [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const { url, s3Key } = await uploadFile(file, 'profile-photos');
      const isPrimary = existingCount === 0 && i === 0; // first ever photo is primary

      const result = await query(
        `INSERT INTO user_photos (user_id, photo_url, s3_key, is_primary, order_index)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, photo_url, is_primary, order_index`,
        [userId, url, s3Key, isPrimary, existingCount + i]
      );
      uploaded.push(result.rows[0]);
    }

    await advanceStep(userId, 8);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: `${uploaded.length} photo(s) uploaded successfully`,
      data: { photos: uploaded, completion_score: score, next_step: 9 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE Photo ─────────────────────────────────────────────
const deletePhoto = async (req, res, next) => {
  try {
    const { photoId } = req.params;
    const userId = req.user.id;

    const result = await query(
      'SELECT s3_key, is_primary FROM user_photos WHERE id = $1 AND user_id = $2',
      [photoId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Photo not found' });
    }

    const photo = result.rows[0];

    // Delete file from storage
    await deleteFile(photo.s3_key);

    // Remove from DB
    await query('DELETE FROM user_photos WHERE id = $1', [photoId]);

    // If deleted photo was primary, make the next one primary
    if (photo.is_primary) {
      await query(
        `UPDATE user_photos SET is_primary = true
         WHERE user_id = $1 AND id = (
           SELECT id FROM user_photos WHERE user_id = $1 ORDER BY order_index LIMIT 1
         )`,
        [userId]
      );
    }

    const score = await recalculateCompletionScore(userId);

    res.json({ success: true, message: 'Photo deleted', data: { completion_score: score } });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 9: Verification (optional govt ID) ──────────────────
const step9 = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const govt_id_type = req.body?.govt_id_type;
    const file = req.file; // optional

    let updateData = {};

    if (file) {
      if (!govt_id_type) {
        return res.status(400).json({ success: false, message: 'govt_id_type is required when uploading ID' });
      }
      const { url, s3Key } = await uploadFile(file, 'govt-ids');
      updateData = { govt_id_url: url, govt_id_s3_key: s3Key, govt_id_type };
    }

    // Upsert verification record
    if (Object.keys(updateData).length > 0) {
      const keys = Object.keys(updateData);
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await query(
        `INSERT INTO user_verification (user_id, ${keys.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
        [userId, ...Object.values(updateData)]
      );
    } else {
      // Ensure row exists even if skipped
      await query(
        `INSERT INTO user_verification (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }

    await advanceStep(userId, 9);
    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: file ? 'Government ID uploaded for verification' : 'Verification step skipped',
      data: { id_uploaded: !!file, completion_score: score, next_step: 10 },
    });
  } catch (err) {
    next(err);
  }
};

// ─── STEP 10: Profile Managed By + Finalize ──────────────────
const step10 = async (req, res, next) => {
  try {
    const { profile_managed_by } = req.body;
    const userId = req.user.id;

    // Check mandatory photo exists before finalizing
    const photoCheck = await query(
      'SELECT COUNT(*) FROM user_photos WHERE user_id = $1',
      [userId]
    );
    if (parseInt(photoCheck.rows[0].count) === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one profile photo is required to complete onboarding. Please go back to step 8.',
        code: 'PHOTO_REQUIRED',
      });
    }

    // Save profile managed by
    await upsertProfile(userId, { profile_managed_by });

    // Generate bio ONLY if user hasn't written one
    const profileRes = await query('SELECT bio, first_name, last_name, denomination, profession, location_city FROM user_profiles WHERE user_id = $1', [userId]);
    const currentProfile = profileRes.rows[0] || {};
    let finalBio = currentProfile.bio;
    
    if (!currentProfile.bio || currentProfile.bio.trim() === '') {
      finalBio = await generateBio(currentProfile);
      await upsertProfile(userId, { bio: finalBio });
    }

    // Mark onboarding complete
    await Promise.all([
      query(
        `UPDATE users SET is_onboarding_complete = true, onboarding_step = 10, updated_at = NOW()
         WHERE id = $1`,
        [userId]
      ),
      query(
        `UPDATE user_profiles SET review_status = 'pending', updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      )
    ]);

    const score = await recalculateCompletionScore(userId);

    res.json({
      success: true,
      message: '🎉 Onboarding complete! Welcome to GraceMatch.',
      data: {
        completion_score: score,
        bio: finalBio,
        is_onboarding_complete: true,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getStatus,
  getHobbies,
  step1, step2, step3, step4, step5,
  step6, step7, step8, step9, step10,
  deletePhoto,
};
