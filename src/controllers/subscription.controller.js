const crypto = require('crypto');
const axios = require('axios');
const { query } = require('../db');
const paymentService = require('../services/payment.service');

// ─── GET Plans ────────────────────────────────────────────────
const getPlans = async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price_inr ASC`);
    res.json({ success: true, data: result.rows });
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

    // Create real Razorpay order
    const rzpOrder = await ps.createOrder({
      amount: plan.price_inr,
      currency: 'INR',
      receipt: `sub_${userId}_${Date.now()}`
    });

    // Create a pending subscription record linked to RZP order_id
    await query(
      `INSERT INTO subscriptions (user_id, plan_id, status, payment_platform, external_order_id) 
       VALUES ($1, $2, 'pending', 'razorpay', $3)`,
      [userId, plan_id, rzpOrder.id]
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
    next(err);
  }
};

// ─── RAZORPAY Webhook ──────────────────────────────────────────
const razorpayWebhook = async (req, res, next) => {
  try {
    const ps = paymentService.getInstance();
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = JSON.stringify(req.body);

    // Verify signature
    const isValid = ps.verifyWebhookSignature(rawBody, signature, secret);
    if (!isValid && process.env.NODE_ENV !== 'development') {
      console.warn('⚠️ Invalid Razorpay webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body.event;
    if (event === 'payment.captured' || event === 'order.paid') {
      const payload = req.body.payload;
      const orderId = payload.order ? payload.order.entity.id : payload.payment.entity.order_id;
      
      // Update subscription status to active
      const subUpdate = await query(
        `UPDATE subscriptions 
         SET status = 'active', 
             activated_at = NOW(),
             expires_at = NOW() + INTERVAL '1 month' 
         WHERE external_order_id = $1 AND status = 'pending'
         RETURNING user_id, plan_id`,
        [orderId]
      );

      if (subUpdate.rows.length > 0) {
        const { user_id, plan_id } = subUpdate.rows[0];
        console.log(`✅ Subscription activated for user ${user_id} (Plan: ${plan_id})`);
        
        // Potential: Send Push Notification for "Premium Activated!"
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).send('Error processing webhook');
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
  verifyIosSubscription,
};
