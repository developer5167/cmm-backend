const { query } = require('../db');

const APP_DOMAIN = process.env.APP_DOMAIN || 'https://gracematch.app';
const APP_PACKAGE = 'com.sotersystems.grace_match';
const APP_BUNDLE  = 'com.sotersystems.gracematch';
// Replace with your actual SHA-256 fingerprint from the keystore
const APP_SHA256  = process.env.ANDROID_SHA256_CERT || 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
// Apple Team ID — set in .env
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'XXXXXXXXXX';

// ─── PUBLIC Profile (no auth) ─────────────────────────────────
// Returns only safe, limited fields suitable for web preview + deep link.
const getPublicProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const profileRes = await query(
      `SELECT p.first_name, p.date_of_birth, p.location_city, p.location_state,
              p.denomination, p.church_name, p.profession, p.trust_badge,
              p.bio, p.profile_visibility,
              (SELECT photo_url FROM user_photos
               WHERE user_id = p.user_id AND is_approved = true AND is_primary = true
               LIMIT 1) as primary_photo,
              u.is_active, u.is_suspended
       FROM user_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [userId]
    );

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const profile = profileRes.rows[0];

    if (!profile.is_active || profile.is_suspended) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    // Respect visibility — hidden profiles are not shareable
    if (profile.profile_visibility === 'hidden') {
      return res.status(403).json({ success: false, message: 'This profile is private' });
    }

    const dob = profile.date_of_birth ? new Date(profile.date_of_birth) : null;
    const age = dob ? new Date().getFullYear() - dob.getFullYear() : null;

    const shareUrl = `${APP_DOMAIN}/p/${userId}`;

    res.json({
      success: true,
      data: {
        user_id: userId,
        name: profile.first_name,
        age,
        location: [profile.location_city, profile.location_state].filter(Boolean).join(', '),
        denomination: profile.denomination,
        church_name: profile.church_name,
        profession: profile.profession,
        bio: profile.bio,
        trust_badge: profile.trust_badge,
        primary_photo: profile.primary_photo,
        share_url: shareUrl,
        app_link: `${APP_DOMAIN}/p/${userId}`, // Same URL — App Link handles it
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Android App Links — assetlinks.json ─────────────────────
const assetLinks = (_req, res) => {
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: APP_PACKAGE,
        sha256_cert_fingerprints: [APP_SHA256],
      },
    },
  ]);
};

// ─── iOS Universal Links — apple-app-site-association ────────
const appleAppSiteAssociation = (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${APPLE_TEAM_ID}.${APP_BUNDLE}`,
          paths: ['/p/*'],
        },
      ],
    },
  });
};

module.exports = { getPublicProfile, assetLinks, appleAppSiteAssociation };
