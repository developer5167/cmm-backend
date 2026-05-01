-- ============================================================
-- GraceMatch – Full Database Schema
-- Version: 1.0.0 | Date: 2026-04-20
-- DB: grace_match | Owner: kcs
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for text search

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE gender_enum AS ENUM ('male', 'female');
CREATE TYPE denomination_enum AS ENUM ('protestant', 'catholic', 'orthodox', 'csi', 'pentecostal', 'born_again', 'other');
CREATE TYPE faith_level_enum AS ENUM ('very_strong', 'strong', 'moderate', 'growing');
CREATE TYPE church_involvement_enum AS ENUM ('very_active', 'active', 'occasional', 'rare');
CREATE TYPE lifestyle_habit_enum AS ENUM ('yes', 'no', 'occasionally');
CREATE TYPE diet_enum AS ENUM ('veg', 'non_veg', 'occasionally');
CREATE TYPE marriage_intent_enum AS ENUM ('ready_now', 'within_6_months', 'within_1_year', 'within_2_years');
CREATE TYPE marriage_timeline_enum AS ENUM ('within_6_months', 'within_1_year', 'within_2_years', 'not_decided');
CREATE TYPE previously_married_enum AS ENUM ('never', 'divorced', 'widowed');
CREATE TYPE profile_managed_by_enum AS ENUM ('self', 'parents', 'others');
CREATE TYPE family_class_enum AS ENUM ('middle', 'upper_middle', 'affluent');
CREATE TYPE interest_status_enum AS ENUM ('sent', 'accepted', 'rejected');
CREATE TYPE who_can_chat_enum AS ENUM ('everyone', 'interests_only');
CREATE TYPE profile_visibility_enum AS ENUM ('everyone', 'interests_only', 'hidden');
CREATE TYPE message_type_enum AS ENUM ('text', 'photo');
CREATE TYPE subscription_plan_name_enum AS ENUM ('silver', 'gold', 'platinum');
CREATE TYPE subscription_status_enum AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE payment_method_enum AS ENUM ('razorpay', 'website');
CREATE TYPE contact_request_status_enum AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE report_status_enum AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');
CREATE TYPE notification_type_enum AS ENUM (
  'interest_received', 'interest_accepted', 'interest_rejected',
  'new_message', 'contact_request', 'contact_approved',
  'profile_viewed', 'shortlisted', 'daily_matches',
  'boost_expired', 'subscription_expiring', 'system'
);
CREATE TYPE admin_role_enum AS ENUM ('super_admin', 'moderator');
CREATE TYPE verification_type_enum AS ENUM ('aadhaar', 'pan', 'passport', 'driving_license', 'voter_id');
CREATE TYPE behavioral_action_enum AS ENUM ('liked', 'skipped', 'time_spent', 'profile_opened');
CREATE TYPE device_type_enum AS ENUM ('android', 'ios');

-- ============================================================
-- CORE AUTH TABLES
-- ============================================================

CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number            VARCHAR(15) UNIQUE NOT NULL,
  country_code            VARCHAR(5) NOT NULL DEFAULT '+91',
  is_phone_verified       BOOLEAN NOT NULL DEFAULT false,
  is_onboarding_complete  BOOLEAN NOT NULL DEFAULT false,
  onboarding_step         INT NOT NULL DEFAULT 0,         -- which step they left off at
  is_active               BOOLEAN NOT NULL DEFAULT true,
  is_suspended            BOOLEAN NOT NULL DEFAULT false,
  suspension_reason       TEXT,
  last_seen_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE otp_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number  VARCHAR(15) NOT NULL,
  otp_code      VARCHAR(6) NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  is_used       BOOLEAN NOT NULL DEFAULT false,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fcm_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  device_type  device_type_enum NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_type)
);

-- ============================================================
-- MASTER / LOOKUP TABLES
-- ============================================================

CREATE TABLE hobbies (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) UNIQUE NOT NULL
);

INSERT INTO hobbies (name) VALUES
  ('Reading'), ('Cooking'), ('Gardening'), ('Travelling'), ('Music'),
  ('Singing'), ('Dancing'), ('Photography'), ('Painting'), ('Sports'),
  ('Yoga'), ('Fitness'), ('Gaming'), ('Movies'), ('Writing'),
  ('Volunteering'), ('Church Ministry'), ('Prayer Groups'), ('Bible Study'),
  ('Worship Leading'), ('Crafts'), ('Hiking'), ('Cycling'), ('Swimming');

CREATE TABLE subscription_plans (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             subscription_plan_name_enum UNIQUE NOT NULL,
  duration_months  INT NOT NULL,
  price_inr        NUMERIC(10, 2) NOT NULL,
  features         JSONB NOT NULL DEFAULT '{}',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans (name, duration_months, price_inr, features) VALUES
  ('silver', 1, 499.00, '{"unlimited_swipes": true, "see_who_viewed": true, "contact_reveals_per_month": 5, "spotlight_boosts": 0, "super_interests": 0}'),
  ('gold',   3, 1199.00,'{"unlimited_swipes": true, "see_who_viewed": true, "contact_reveals_per_month": -1, "spotlight_boosts": 2, "super_interests": 1}'),
  ('platinum',6, 1999.00,'{"unlimited_swipes": true, "see_who_viewed": true, "contact_reveals_per_month": -1, "spotlight_boosts": -1, "super_interests": -1, "priority_discover": true, "dedicated_support": true}');

-- ============================================================
-- USER PROFILE TABLES
-- ============================================================

CREATE TABLE user_profiles (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                   UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Basic
  gender                    gender_enum,
  looking_for               gender_enum,
  first_name                VARCHAR(100),
  last_name                 VARCHAR(100),
  date_of_birth             DATE,
  location_city             VARCHAR(100),
  location_state            VARCHAR(100),
  location_country          VARCHAR(100) DEFAULT 'India',
  latitude                  DECIMAL(9, 6),
  longitude                 DECIMAL(9, 6),

  -- Matrimony Core
  marriage_intent           marriage_intent_enum,
  denomination              denomination_enum,
  church_name               VARCHAR(200),
  faith_level               faith_level_enum,
  church_involvement        church_involvement_enum,
  caste                     VARCHAR(100),

  -- Personal
  education                 VARCHAR(200),
  profession                VARCHAR(200),
  annual_income_min         INT,          -- in INR, per annum
  annual_income_max         INT,

  -- Lifestyle
  smoking                   lifestyle_habit_enum,
  drinking                  lifestyle_habit_enum,
  diet                      diet_enum,
  gym                       lifestyle_habit_enum,

  -- Profile Management
  profile_managed_by        profile_managed_by_enum,

  -- Additional Fields
  height_cm                 INT,
  complexion                VARCHAR(50),
  native_place              VARCHAR(100),
  languages_spoken          TEXT[],         -- array of language strings
  marriage_timeline         marriage_timeline_enum,
  previously_married        previously_married_enum DEFAULT 'never',
  has_special_needs         BOOLEAN DEFAULT false,
  special_needs_details     TEXT,           -- only visible if user allows

  -- AI
  bio                       TEXT,           -- LLM generated

  -- Privacy Controls
  profile_visibility        profile_visibility_enum NOT NULL DEFAULT 'everyone',
  who_can_chat              who_can_chat_enum NOT NULL DEFAULT 'interests_only',
  is_contact_sharing_allowed BOOLEAN NOT NULL DEFAULT true,
  is_images_locked          BOOLEAN NOT NULL DEFAULT true,

  -- Trust & Completion
  profile_completion_score  INT NOT NULL DEFAULT 0,
  trust_badge               BOOLEAN NOT NULL DEFAULT false,
  authenticity_score        INT NOT NULL DEFAULT 0,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_family (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  father_occupation       VARCHAR(200),
  mother_occupation       VARCHAR(200),
  brothers_count          INT DEFAULT 0,
  sisters_count           INT DEFAULT 0,
  married_brothers_count  INT DEFAULT 0,
  married_sisters_count   INT DEFAULT 0,
  family_income_range     VARCHAR(100),   -- e.g. "5-10 LPA", "10-20 LPA"
  family_class            family_class_enum,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_partner_preferences (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  age_min                 INT,
  age_max                 INT,
  location_flexible       BOOLEAN DEFAULT true,
  preferred_locations     TEXT[],          -- array of city/state names
  denomination_flexible   BOOLEAN DEFAULT true,
  preferred_denominations denomination_enum[],
  caste_flexible          BOOLEAN DEFAULT true,
  preferred_castes        TEXT[],
  education_preference    TEXT,
  profession_preference   TEXT,
  salary_min              INT,
  salary_max              INT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_hobbies (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hobby_id  INT NOT NULL REFERENCES hobbies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, hobby_id)
);

CREATE TABLE user_photos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_url    TEXT NOT NULL,
  s3_key       TEXT NOT NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  is_approved  BOOLEAN NOT NULL DEFAULT true, -- admin can set false
  order_index  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_verification references admin_users, so admin_users is created first (see ADMIN SYSTEM section)
-- We add the FK constraint after admin_users is created (see ALTER at end of file)
CREATE TABLE user_verification (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Government ID
  govt_id_url           TEXT,
  govt_id_s3_key        TEXT,
  govt_id_type          verification_type_enum,
  is_id_verified        BOOLEAN NOT NULL DEFAULT false,
  id_verified_at        TIMESTAMPTZ,
  id_verified_by        UUID,              -- FK added below after admin_users is created
  id_rejection_reason   TEXT,
  -- Video Selfie
  selfie_video_url      TEXT,
  selfie_video_s3_key   TEXT,
  is_selfie_verified    BOOLEAN NOT NULL DEFAULT false,
  selfie_verified_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INTEREST & MATCHING SYSTEM
-- ============================================================

CREATE TABLE interests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_super_interest BOOLEAN NOT NULL DEFAULT false,
  status            interest_status_enum NOT NULL DEFAULT 'sent',
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at      TIMESTAMPTZ,
  UNIQUE(sender_id, receiver_id),
  CHECK (sender_id != receiver_id)
);

CREATE TABLE shortlists (
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shortlisted_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, shortlisted_user_id),
  CHECK (user_id != shortlisted_user_id)
);

CREATE TABLE profile_views (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  viewer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (viewer_id != viewed_id)
);

CREATE TABLE behavioral_signals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action              behavioral_action_enum NOT NULL,
  time_spent_seconds  INT DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id != target_user_id)
);

-- ============================================================
-- CHAT SYSTEM
-- ============================================================

CREATE TABLE conversations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interest_id      UUID UNIQUE NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  user1_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user1_id != user2_id)
);

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content          TEXT,
  message_type     message_type_enum NOT NULL DEFAULT 'text',
  photo_url        TEXT,
  photo_s3_key     TEXT,
  is_read          BOOLEAN NOT NULL DEFAULT false,
  read_at          TIMESTAMPTZ,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contact_requests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status              contact_request_status_enum NOT NULL DEFAULT 'pending',
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at        TIMESTAMPTZ,
  UNIQUE(requester_id, requested_user_id),
  CHECK (requester_id != requested_user_id)
);

-- ============================================================
-- PRIVACY & SAFETY
-- ============================================================

CREATE TABLE blocks (
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

CREATE TABLE reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason            VARCHAR(200) NOT NULL,
  description       TEXT,
  status            report_status_enum NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID,              -- FK added below after admin_users is created
  resolution_note   TEXT,
  CHECK (reporter_id != reported_user_id)
);

-- ============================================================
-- SUBSCRIPTION & MONETIZATION
-- ============================================================

CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id             UUID NOT NULL REFERENCES subscription_plans(id),
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  payment_method      payment_method_enum NOT NULL,
  status              subscription_status_enum NOT NULL DEFAULT 'active',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at        TIMESTAMPTZ
);

CREATE TABLE spotlight_boosts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ NOT NULL,              -- typically starts_at + 24h
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         notification_type_enum NOT NULL,
  title        VARCHAR(200) NOT NULL,
  body         TEXT NOT NULL,
  data         JSONB DEFAULT '{}',
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ADMIN SYSTEM
-- ============================================================

CREATE TABLE admin_users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email          VARCHAR(200) UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  role           admin_role_enum NOT NULL DEFAULT 'moderator',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE success_stories (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_text   TEXT NOT NULL,
  photo_url    TEXT,
  photo_s3_key TEXT,
  is_approved  BOOLEAN NOT NULL DEFAULT false,
  approved_by  UUID REFERENCES admin_users(id),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user1_id != user2_id)
);

-- ============================================================
-- INDEXES (Performance)
-- ============================================================

-- Users & Auth
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_otp_phone ON otp_sessions(phone_number, is_used);
CREATE INDEX idx_fcm_user ON fcm_tokens(user_id);

-- Profile discovery performance
CREATE INDEX idx_profiles_gender ON user_profiles(gender, looking_for);
CREATE INDEX idx_profiles_denomination ON user_profiles(denomination);
CREATE INDEX idx_profiles_location ON user_profiles(location_state, location_city);
CREATE INDEX idx_profiles_visibility ON user_profiles(profile_visibility);
CREATE INDEX idx_profiles_dob ON user_profiles(date_of_birth);
CREATE INDEX idx_profiles_completion ON user_profiles(profile_completion_score DESC);

-- Photos
CREATE INDEX idx_photos_user ON user_photos(user_id, is_primary);

-- Interests
CREATE INDEX idx_interests_sender ON interests(sender_id, status);
CREATE INDEX idx_interests_receiver ON interests(receiver_id, status);

-- Chat
CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_conversations_user1 ON conversations(user1_id, last_message_at DESC);
CREATE INDEX idx_conversations_user2 ON conversations(user2_id, last_message_at DESC);

-- Notifications
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Views & Shortlists
CREATE INDEX idx_profile_views_viewed ON profile_views(viewed_id, viewed_at DESC);
CREATE INDEX idx_shortlists_user ON shortlists(user_id);

-- Subscriptions
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, status, expires_at);

-- Behavioral signals
CREATE INDEX idx_behavioral_user ON behavioral_signals(user_id, target_user_id);

-- Spotlight
CREATE INDEX idx_spotlight_user ON spotlight_boosts(user_id, ends_at DESC);

-- Blocks
CREATE INDEX idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

-- Reports
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

-- ============================================================
-- TRIGGERS — auto update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_family_updated_at BEFORE UPDATE ON user_family FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_prefs_updated_at BEFORE UPDATE ON user_partner_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_verification_updated_at BEFORE UPDATE ON user_verification FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_fcm_updated_at BEFORE UPDATE ON fcm_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_admin_updated_at BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- DEFERRED FK CONSTRAINTS (admin_users created after the tables that reference it)
-- ============================================================

ALTER TABLE user_verification
  ADD CONSTRAINT fk_verification_verified_by
  FOREIGN KEY (id_verified_by) REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE reports
  ADD CONSTRAINT fk_reports_reviewed_by
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL;
