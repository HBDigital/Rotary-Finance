const express = require('express');
const router = express.Router();

const districtDuesController = require('../controllers/districtDuesController');
const subscriptionsController = require('../controllers/subscriptionsController');
const fundraisersController = require('../controllers/fundraisersController');
const financeController = require('../controllers/financeController');

// District Dues Routes
router.post('/district-dues', districtDuesController.getDistrictDues);
router.post('/district-dues/mark-paid', districtDuesController.markAsPaid);
router.post('/district-dues/send-reminder', districtDuesController.sendReminder);

// Subscriptions Routes
router.post('/subscriptions', subscriptionsController.getSubscriptions);
router.post('/subscriptions/create', subscriptionsController.createSubscription);
router.post('/subscriptions/update', subscriptionsController.updateSubscription);
router.post('/subscriptions/deactivate', subscriptionsController.deactivateSubscription);
router.post('/subscriptions/transactions', subscriptionsController.getTransactions);
router.post('/subscriptions/mark-paid', subscriptionsController.markTransactionPaid);
router.post('/subscriptions/add-members', subscriptionsController.addMembers);

// Fundraisers Routes
router.post('/fundraisers', fundraisersController.getFundraisers);
router.post('/fundraisers/create', fundraisersController.createFundraiser);
router.post('/fundraisers/update', fundraisersController.updateFundraiser);
router.post('/fundraisers/donations', fundraisersController.getDonations);
router.post('/fundraisers/add-donation', fundraisersController.addDonation);
router.post('/fundraisers/sharing-stats', fundraisersController.getSharingStats);

// Common Finance Routes
router.post('/summary', financeController.getFinanceSummary);

module.exports = router;
