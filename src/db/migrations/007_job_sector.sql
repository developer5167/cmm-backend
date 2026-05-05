-- Job sector for profession filters (Private / Government / Business / Other)
-- Matches values sent from onboarding step 3: pvt, govt, business, other
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS job_sector VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_user_profiles_job_sector ON user_profiles (job_sector);
