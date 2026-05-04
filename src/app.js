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
const activityRoutes = require('./routes/activity.routes');
const shareRoutes    = require('./routes/share.routes');
const { assetLinks, appleAppSiteAssociation } = require('./controllers/share.controller');

const app = express();

// Trust proxy for rate limiting behind ngrok/load balancers
app.set('trust proxy', 1);

// ─── Security ────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));

// ─── CORS ────────────────────────────────────────────────────
// Allow all origins in development to prevent 403s over tunnels
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'ngrok-skip-browser-warning'],
}));

// ─── Rate limiting ───────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Increased for debugging redirect loops
  message: { success: false, message: 'Too many auth attempts, please wait 5 minutes.' },
});

app.use(globalLimiter);

// ─── Parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Custom Detailed Logging ─────────────────────────────────
app.use((req, res, next) => {
  console.log(`\n========================================================`);
  console.log(`➡️  [REQUEST] ${req.method} ${req.originalUrl}`);
  if (req.body && Object.keys(req.body).length) console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  if (req.query && Object.keys(req.query).length) console.log('❓ Query:', JSON.stringify(req.query, null, 2));

  const originalJson = res.json;
  res.json = function (body) {
    console.log(`⬅️  [RESPONSE] ${req.method} ${req.originalUrl} - Status: ${res.statusCode}`);
    console.log('📦 Body:', JSON.stringify(body, null, 2));
    console.log(`========================================================\n`);
    return originalJson.call(this, body);
  };
  next();
});

// ─── Logging ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Static files (dev only — uploads) ───────────────────────
if (process.env.NODE_ENV === 'development') {
  const path = require('path');
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// ─── Well-known (App Links + Universal Links) ─────────────────
app.get('/.well-known/assetlinks.json',          assetLinks);
app.get('/.well-known/apple-app-site-association', appleAppSiteAssociation);

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
app.use('/api/v1/activity', activityRoutes);
app.use('/api/v1/share',   shareRoutes);

// ─── 404 & Error Handlers ────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
