const crypto = require('crypto');
const axios = require('axios');
const { query } = require('../db');
const paymentService = require('../services/payment.service');

// ─── GET Plans ────────────────────────────────────────────────
const getPlans = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [plansRes, currentSubRes] = await Promise.all([
      query(`SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price_inr ASC`),
      query(
        `SELECT s.plan_id, s.expires_at, sp.name AS plan_name
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

    const current = currentSubRes.rows[0] || null;
    const plans = plansRes.rows.map((p) => {
      const isCurrentActive = current?.plan_id === p.id;
      return {
        ...p,
        is_current_active: !!isCurrentActive,
        can_purchase: !isCurrentActive,
        disabled_reason: isCurrentActive
          ? `Current plan active until ${new Date(current.expires_at).toISOString()}`
          : null,
        current_subscription: current
          ? {
              plan_id: current.plan_id,
              plan_name: current.plan_name,
              expires_at: current.expires_at,
            }
          : null,
      };
    });
    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
};

// ─── CREATE Razorpay Order ────────────────────────────────────
const createRazorpayOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { plan_id } = req.body;
    const ps = paymentService.getInstance();

    // Fetch plan
    const planRes = await query(`SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true`, [plan_id]);
    if (planRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    const plan = planRes.rows[0];

    // Do not allow buying same plan while it is currently active.
    const activeSamePlanRes = await query(
      `SELECT id, expires_at
         FROM subscriptions
        WHERE user_id = $1
          AND plan_id = $2
          AND status = 'active'
          AND expires_at > NOW()
        LIMIT 1`,
      [userId, plan_id]
    );
    if (activeSamePlanRes.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This plan is already active. Please choose another plan or wait until expiry.',
      });
    }

    // Create real Razorpay order
    // Razorpay receipt max length is 40 chars.
    const shortUser = userId.toString().replace(/-/g, '').slice(0, 10);
    const shortTs = Date.now().toString(36);
    const receipt = `sub_${shortUser}_${shortTs}`.slice(0, 40);

    let rzpOrder;
    try {
      rzpOrder = await ps.createOrder({
        amount: plan.price_inr,
        currency: 'INR',
        receipt,
      });
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message || 'Unable to create Razorpay order',
      });
    }

    // Create a pending subscription record linked to RZP order_id
    await query(
      `INSERT INTO subscriptions (
          user_id, plan_id, status, payment_method, razorpay_order_id, started_at, expires_at
       )
       VALUES (
          $1, $2, 'pending', 'razorpay', $3, NOW(), NOW() + ($4 || ' months')::INTERVAL
       )`,
      [userId, plan_id, rzpOrder.id, plan.duration_months || 1]
    );

    res.json({
      success: true,
      data: {
        order_id: rzpOrder.id,
        amount: plan.price_inr,
        key: process.env.RAZORPAY_KEY_ID,
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Internal server error',
    });
  }
};

// ─── RAZORPAY Webhook ──────────────────────────────────────────
const razorpayWebhook = async (req, res, next) => {
  try {
    const ps = paymentService.getInstance();
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body || {});

    // Verify signature
    const isValid = ps.verifyWebhookSignature(rawBody, signature, secret);
    if (!isValid && process.env.NODE_ENV !== 'development') {
      console.warn('⚠️ Invalid Razorpay webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body?.event;
    if (!event) {
      return res.status(200).json({ status: 'ignored', reason: 'missing event' });
    }
    if (event === 'payment.captured' || event === 'order.paid') {
      const payload = req.body?.payload || {};
      const orderId =
        payload?.order?.entity?.id ||
        payload?.payment?.entity?.order_id ||
        null;
      const paymentId = payload?.payment?.entity?.id || null;

      if (!orderId) {
        return res.status(200).json({ status: 'ignored', reason: 'missing order id' });
      }
      
      // Update subscription status to active
      const subUpdate = await query(
        `UPDATE subscriptions s
            SET status = 'active',
                started_at = NOW(),
                expires_at = NOW() + (sp.duration_months || ' months')::INTERVAL,
                razorpay_payment_id = $2
           FROM subscription_plans sp
          WHERE s.plan_id = sp.id
            AND s.razorpay_order_id = $1
            AND s.status = 'pending'
          RETURNING s.user_id, s.plan_id`,
        [orderId, paymentId]
      );

      if (subUpdate.rows.length > 0) {
        const { user_id, plan_id } = subUpdate.rows[0];
        // Override any other active plans when a new plan is purchased.
        await query(
          `UPDATE subscriptions
              SET status = 'cancelled',
                  cancelled_at = NOW()
            WHERE user_id = $1
              AND status = 'active'
              AND razorpay_order_id <> $2`,
          [user_id, orderId]
        );
        console.log(`✅ Subscription activated for user ${user_id} (Plan: ${plan_id})`);
        
        // Potential: Send Push Notification for "Premium Activated!"
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook Error:', err);
    // Return 200 to avoid endless retries for non-actionable payloads.
    res.status(200).json({ status: 'ignored', reason: 'handler error' });
  }
};

// ─── VERIFY Razorpay Payment (mobile client-side verify) ─────
const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const ps = paymentService.getInstance();
    const isValid = ps.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (!isValid && process.env.NODE_ENV !== 'development') {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    // Fetch the plan's duration to calculate correct expiry
    const subRes = await query(
      `SELECT s.id, s.plan_id, sp.duration_months
         FROM subscriptions s
         JOIN subscription_plans sp ON sp.id = s.plan_id
        WHERE s.user_id = $1 AND s.razorpay_order_id = $2 AND s.status = 'pending'
        LIMIT 1`,
      [userId, razorpay_order_id]
    );

    if (subRes.rows.length === 0) {
      // Order may already be activated via webhook — still return success
      const activeCheck = await query(
        `SELECT id FROM subscriptions WHERE user_id = $1 AND razorpay_order_id = $2 AND status = 'active' LIMIT 1`,
        [userId, razorpay_order_id]
      );
      if (activeCheck.rows.length > 0) {
        return res.json({ success: true, message: 'Subscription already active' });
      }
      return res.status(404).json({ success: false, message: 'Order not found or already processed' });
    }

    const { id: subId, duration_months } = subRes.rows[0];

    // Override old active plans before enabling the new one.
    await query(
      `UPDATE subscriptions
          SET status = 'cancelled',
              cancelled_at = NOW()
        WHERE user_id = $1
          AND status = 'active'
          AND id <> $2`,
      [userId, subId]
    );

    await query(
      `UPDATE subscriptions
          SET status = 'active',
              started_at = NOW(),
              expires_at = NOW() + ($1 || ' months')::INTERVAL,
              razorpay_payment_id = $2
        WHERE id = $3`,
      [duration_months || 1, razorpay_payment_id, subId]
    );

    res.json({ success: true, message: 'Subscription activated successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── VERIFY iOS Subscription ──────────────────────────────────
const verifyIosSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { receipt_data, plan_id } = req.body;
    
    // Apple In-App Purchase verification placeholder
    const isValid = !!receipt_data; 

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid receipt' });
    }

    // Activate subscription
    const result = await query(
      `INSERT INTO subscriptions (user_id, plan_id, status, payment_platform, activated_at, expires_at) 
       VALUES ($1, $2, 'active', 'ios', NOW(), NOW() + INTERVAL '1 month') RETURNING *`,
      [userId, plan_id]
    );

    res.json({ success: true, message: 'Subscription activated', data: result.rows[0] });

  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPlans,
  createRazorpayOrder,
  razorpayWebhook,
  verifyRazorpayPayment,
  verifyIosSubscription,
};
