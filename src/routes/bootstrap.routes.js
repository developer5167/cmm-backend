const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { getBootstrap }  = require('../controllers/bootstrap.controller');

router.get('/', authMiddleware, getBootstrap);

module.exports = router;
