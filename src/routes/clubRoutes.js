const express = require('express');
const router = express.Router();

const clubController = require('../controllers/clubController');

// Club Routes
router.post('/details', clubController.getClubDetails);
router.post('/members', clubController.getMembersList);
router.post('/member-details', clubController.getMemberDetails);

module.exports = router;
