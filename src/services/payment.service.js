const Razorpay = require('razorpay');
const crypto = require('crypto');

/**
 * Payment Service - GraceMatch
 * Handles Razorpay order creation and verification.
 */
class PaymentService {
  constructor() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay keys are missing in environment');
    }
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  /**
   * Create Razorpay Order
   * @param {Object} options - { amount (in INR), currency, receipt }
   */
  async createOrder({ amount, currency = 'INR', receipt }) {
    try {
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error(`Invalid amount for Razorpay order: ${amount}`);
      }
      const options = {
        amount: Math.round(amountNum * 100), // Razorpay works in paise
        currency,
        receipt,
      };
      return await this.razorpay.orders.create(options);
    } catch (err) {
      const details =
        err?.error?.description ||
        err?.response?.data?.error?.description ||
        err?.response?.data?.message ||
        err?.message ||
        'Razorpay order creation failed';
      console.error('❌ Razorpay Order Creation Error:', details);
      const wrapped = new Error(details);
      wrapped.statusCode = 400;
      throw wrapped;
    }
  }

  /**
   * Verify Payment Signature
   */
  verifySignature(order_id, payment_id, signature) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${order_id}|${payment_id}`);
    const expectedSig = hmac.digest('hex');
    return expectedSig === signature;
  }

  /**
   * Verify Webhook Signature
   */
  verifyWebhookSignature(rawBody, signature, secret) {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return expectedSig === signature;
  }
}

let instance = null;

const getInstance = () => {
  if (!instance) {
    instance = new PaymentService();
  }
  return instance;
};

module.exports = { getInstance };
