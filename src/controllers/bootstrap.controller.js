const { query } = require('../db');

// ─── GET /api/v1/app/bootstrap ────────────────────────────────
// Single call on app launch. Returns:
//   • user status (onboarding, review, primary photo)
//   • badge counts (unread notifs, pending interests, unread messages)
//   • subscription status
//
// Uses Promise.allSettled so partial failures never block the launch.
const getBootstrap = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [userResult, badgesResult, subResult] = await Promise.allSettled([
      // 1. User + profile basics
      query(
        `SELECT u.id, u.is_onboarding_complete,
                p.review_status, p.first_name, p.profile_completion_score,
                (SELECT ph.photo_url
                   FROM user_photos ph
                  WHERE ph.user_id = u.id
                    AND ph.is_primary = true
                    AND ph.is_approved = true
                  LIMIT 1) AS primary_photo
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
          WHERE u.id = $1`,
        [userId]
      ),

      // 2. Badge counts — single round-trip
      query(
        `SELECT
           (SELECT COUNT(*)::int
              FROM notifications
             WHERE user_id = $1 AND is_read = false)            AS unread_notifications,

           (SELECT COUNT(*)::int
              FROM interests
             WHERE receiver_id = $1 AND status = 'sent')        AS pending_interests,

           (SELECT COUNT(DISTINCT m.conversation_id)::int
              FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
             WHERE (c.user1_id = $1 OR c.user2_id = $1)
               AND m.sender_id != $1
               AND m.is_read = false)                           AS unread_messages`,
        [userId]
      ),

      // 3. Active subscription
      query(
        `SELECT sp.name AS plan_name, s.expires_at AS ends_at
           FROM subscriptions s
           JOIN subscription_plans sp ON sp.id = s.plan_id
          WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > NOW()
          ORDER BY s.expires_at DESC
          LIMIT 1`,
        [userId]
      ),
    ]);

    const user   = userResult.status   === 'fulfilled' ? userResult.value.rows[0]   : null;
    const badges = badgesResult.status === 'fulfilled' ? badgesResult.value.rows[0] : null;
    const sub    = subResult.status    === 'fulfilled' ? subResult.value.rows[0]    : null;

    res.json({
      success: true,
      data: {
        user: user
          ? {
              id:                        user.id,
              first_name:                user.first_name,
              review_status:             user.review_status,
              is_onboarding_complete:    user.is_onboarding_complete,
              primary_photo:             user.primary_photo,
              profile_completion_score:  user.profile_completion_score,
            }
          : null,
        badges: {
          unread_notifications: badges?.unread_notifications ?? 0,
          pending_interests:    badges?.pending_interests    ?? 0,
          unread_messages:      badges?.unread_messages      ?? 0,
        },
        subscription: sub
          ? { is_premium: true,  plan_name: sub.plan_name, ends_at: sub.ends_at }
          : { is_premium: false, plan_name: null,          ends_at: null },
        errors: {
          user:         userResult.status   === 'rejected' ? userResult.reason?.message   : null,
          badges:       badgesResult.status === 'rejected' ? badgesResult.reason?.message : null,
          subscription: subResult.status    === 'rejected' ? subResult.reason?.message    : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getBootstrap };
