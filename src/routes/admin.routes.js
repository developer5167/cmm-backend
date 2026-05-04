const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect, adminOnly } = require('../middleware/auth.middleware');

router.use(adminOnly);

router.get('/revisions', adminController.getPendingRevisions);
router.put('/revisions/:id', adminController.reviewRevision);
router.post('/revisions/:id/lock', adminController.lockRevision);
router.post('/revisions/:id/unlock', adminController.unlockRevision);

router.get('/staff', adminController.getStaff);
router.post('/staff', adminController.createStaff);
router.put('/staff/:id/status', adminController.toggleStaffStatus);

router.get('/applications', adminController.getPendingApplications);
router.put('/applications/:userId', adminController.reviewApplication);
router.post('/applications/:userId/lock', adminController.lockApplication);
router.post('/applications/:userId/unlock', adminController.unlockApplication);

router.get('/photos/pending', adminController.getPendingPhotos);
router.put('/photos/:photoId', adminController.reviewPhoto);

// ─── Per-user activity stats (for admin detail view) ─────────
router.get('/users/:userId/views',          adminController.getUserViewStats);
router.get('/users/:userId/shortlisted-by', adminController.getUserShortlistStats);
router.get('/users/:userId/notifications',  adminController.getUserNotifStats);

module.exports = router;
