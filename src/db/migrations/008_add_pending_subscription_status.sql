-- Add missing status used by Razorpay order flow
-- Existing code creates a subscription row before payment capture using 'pending'
ALTER TYPE subscription_status_enum ADD VALUE IF NOT EXISTS 'pending';

