const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { errorHandler, notFound } = require('./middleware/error.middleware');

// Route imports
const authRoutes = require('./routes/auth.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const profileRoutes = require('./routes/profile.routes');
const discoverRoutes = require('./routes/discover.routes');
const interestRoutes = require('./routes/interest.routes');
const chatRoutes = require('./routes/chat.routes');
const notificationRoutes = require('./routes/notification.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const adminRoutes = require('./routes/admin.routes');
const premiumRoutes = require('./routes/premium.routes');
const trustRoutes = require('./routes/trust.routes');
const growthRoutes = require('./routes/growth.routes');

const app = express();
// ... (cutting out the comment to avoid breaking the replacement if the context is tight, I will use exact string replacement instead of changing imports up there)

// ─── Security ────────────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

// ─── Rate limiting ───────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: { success: false, message: 'Too many auth attempts, please wait 5 minutes.' },
});

app.use(globalLimiter);

// ─── Parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Static files (dev only — uploads) ───────────────────────
if (process.env.NODE_ENV === 'development') {
  const path = require('path');
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    app: 'GraceMatch API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/discover', discoverRoutes);
app.use('/api/v1/interests', interestRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/premium', premiumRoutes);
app.use('/api/v1/trust', trustRoutes);
app.use('/api/v1/growth', growthRoutes);

// ─── 404 & Error Handlers ────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
