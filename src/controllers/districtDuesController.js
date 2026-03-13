const pool = require('../config/database');
const manchesterPool = require('../config/manchesterDb');
const { generateId, formatDateForDB, apiResponse, errorResponse, validateRequired, getCurrentRotaryYear } = require('../utils/helpers');
const { getClubByUserkey, getMembersByUserkey } = require('../utils/clubHelper');

// ============================================================================
// API 1: GET CONFIG - Returns district dues config for a rotary year
// ============================================================================
const getConfig = async (req, res) => {
  try {
    const { rotary_year } = req.body;
    const targetYear = rotary_year || getCurrentRotaryYear();

    const [config] = await pool.query(`
      SELECT amount, transaction_fee_percent, rotary_year, due_date
      FROM district_dues_config 
      WHERE rotary_year = ?
    `, [targetYear]);

    if (config.length === 0) {
      // Return default config if not set
      return apiResponse(res, true, {
        amount: 1000,
        transaction_fee_percent: 2.5,
        rotary_year: targetYear,
        due_date: null
      }, 'Default config returned (not configured yet)');
    }

    return apiResponse(res, true, {
      amount: parseFloat(config[0].amount),
      transaction_fee_percent: parseFloat(config[0].transaction_fee_percent),
      rotary_year: config[0].rotary_year,
      due_date: config[0].due_date
    }, 'Config fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch config', 500, error);
  }
};

// ============================================================================
// API 2: UPDATE CONFIG (Admin) - Set amount and transaction_fee_percent
// ============================================================================
const updateConfig = async (req, res) => {
  try {
    const { rotary_year, amount, transaction_fee_percent, due_date } = req.body;

    const validation = validateRequired(req.body, ['rotary_year', 'amount', 'transaction_fee_percent']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Check if config exists for this year
    const [existing] = await pool.query(
      'SELECT id FROM district_dues_config WHERE rotary_year = ?',
      [rotary_year]
    );

    if (existing.length > 0) {
      // Update existing config
      await pool.query(`
        UPDATE district_dues_config 
        SET amount = ?, transaction_fee_percent = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE rotary_year = ?
      `, [amount, transaction_fee_percent, formatDateForDB(due_date), rotary_year]);
    } else {
      // Create new config
      await pool.query(`
        INSERT INTO district_dues_config (id, rotary_year, amount, transaction_fee_percent, due_date)
        VALUES (?, ?, ?, ?, ?)
      `, [generateId(), rotary_year, amount, transaction_fee_percent, formatDateForDB(due_date)]);
    }

    return apiResponse(res, true, {
      rotary_year,
      amount,
      transaction_fee_percent,
      due_date
    }, 'Config updated successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to update config', 500, error);
  }
};

// ============================================================================
// API 3: CLUB SUMMARY - Returns club's dues calculation and payment status
// ============================================================================
const getClubSummary = async (req, res) => {
  try {
    const { userkey, rotary_year } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    // Verify club exists
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }

    const targetYear = rotary_year || getCurrentRotaryYear();

    // Get config for this year
    const [config] = await pool.query(`
      SELECT amount, transaction_fee_percent, due_date
      FROM district_dues_config 
      WHERE rotary_year = ?
    `, [targetYear]);

    const amountPerMember = config.length > 0 ? parseFloat(config[0].amount) : 1000;
    const transactionFeePercent = config.length > 0 ? parseFloat(config[0].transaction_fee_percent) : 2.5;
    const dueDate = config.length > 0 ? config[0].due_date : null;

    // Get member count from manchesterclub
    const members = await getMembersByUserkey(userkey);
    const memberCount = members.length;

    // Calculate totals
    const totalAmount = memberCount * amountPerMember;
    const transactionFee = (totalAmount * transactionFeePercent) / 100;
    const grandTotal = totalAmount + transactionFee;

    // Check if club has already paid for this year
    const [payment] = await pool.query(`
      SELECT id, status, paid_on, payment_mode, reference_id, notes
      FROM district_dues_club_payments 
      WHERE club_id = ? AND rotary_year = ?
    `, [userkey, targetYear]);

    const paymentStatus = payment.length > 0 ? payment[0].status : 'pending';
    const paidOn = payment.length > 0 ? payment[0].paid_on : null;
    const referenceId = payment.length > 0 ? payment[0].reference_id : null;
    const paymentMode = payment.length > 0 ? payment[0].payment_mode : null;

    return apiResponse(res, true, {
      club_id: userkey,
      club_name: club.clubname,
      rotary_year: targetYear,
      member_count: memberCount,
      amount_per_member: amountPerMember,
      total_amount: totalAmount,
      transaction_fee_percent: transactionFeePercent,
      transaction_fee: transactionFee,
      grand_total: grandTotal,
      due_date: dueDate,
      status: paymentStatus,
      paid_on: paidOn,
      payment_mode: paymentMode,
      reference_id: referenceId
    }, 'Club summary fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch club summary', 500, error);
  }
};

// ============================================================================
// API 4: PAY - Record club payment for district dues
// ============================================================================
const payDues = async (req, res) => {
  try {
    const { userkey, rotary_year, payment_mode, reference_id, notes } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'payment_mode', 'reference_id']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }

    const targetYear = rotary_year || getCurrentRotaryYear();

    // Check if already paid
    const [existingPayment] = await pool.query(`
      SELECT id, status FROM district_dues_club_payments 
      WHERE club_id = ? AND rotary_year = ?
    `, [userkey, targetYear]);

    if (existingPayment.length > 0 && existingPayment[0].status === 'paid') {
      return errorResponse(res, 'Dues already paid for this year', 400);
    }

    // Get config
    const [config] = await pool.query(`
      SELECT amount, transaction_fee_percent
      FROM district_dues_config 
      WHERE rotary_year = ?
    `, [targetYear]);

    const amountPerMember = config.length > 0 ? parseFloat(config[0].amount) : 1000;
    const transactionFeePercent = config.length > 0 ? parseFloat(config[0].transaction_fee_percent) : 2.5;

    // Get member count
    const members = await getMembersByUserkey(userkey);
    const memberCount = members.length;

    // Calculate totals
    const totalAmount = memberCount * amountPerMember;
    const transactionFee = (totalAmount * transactionFeePercent) / 100;
    const grandTotal = totalAmount + transactionFee;

    const paidOn = formatDateForDB(new Date());

    if (existingPayment.length > 0) {
      // Update existing record
      await pool.query(`
        UPDATE district_dues_club_payments 
        SET member_count = ?, amount_per_member = ?, total_amount = ?,
            transaction_fee_percent = ?, transaction_fee = ?, grand_total = ?,
            status = 'paid', paid_on = ?, payment_mode = ?, reference_id = ?, notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE club_id = ? AND rotary_year = ?
      `, [memberCount, amountPerMember, totalAmount, transactionFeePercent, transactionFee, grandTotal,
          paidOn, payment_mode, reference_id, notes, userkey, targetYear]);
    } else {
      // Create new payment record
      await pool.query(`
        INSERT INTO district_dues_club_payments 
        (id, club_id, rotary_year, member_count, amount_per_member, total_amount,
         transaction_fee_percent, transaction_fee, grand_total, status, paid_on, payment_mode, reference_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
      `, [generateId(), userkey, targetYear, memberCount, amountPerMember, totalAmount,
          transactionFeePercent, transactionFee, grandTotal, paidOn, payment_mode, reference_id, notes]);
    }

    return apiResponse(res, true, {
      club_id: userkey,
      rotary_year: targetYear,
      member_count: memberCount,
      total_amount: totalAmount,
      transaction_fee: transactionFee,
      grand_total: grandTotal,
      status: 'paid',
      paid_on: paidOn,
      reference_id: reference_id
    }, 'Payment recorded successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to record payment', 500, error);
  }
};

// ============================================================================
// API 5: PAYMENT HISTORY - Returns past years' payments for a club
// ============================================================================
const getPaymentHistory = async (req, res) => {
  try {
    const { userkey } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    // Verify club exists
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }

    const [payments] = await pool.query(`
      SELECT 
        rotary_year,
        member_count,
        amount_per_member,
        total_amount,
        transaction_fee_percent,
        transaction_fee,
        grand_total,
        status,
        paid_on,
        payment_mode,
        reference_id,
        notes,
        created_at
      FROM district_dues_club_payments 
      WHERE club_id = ?
      ORDER BY rotary_year DESC
    `, [userkey]);

    return apiResponse(res, true, {
      club_id: userkey,
      club_name: club.clubname,
      payments: payments.map(p => ({
        rotary_year: p.rotary_year,
        member_count: p.member_count,
        amount_per_member: parseFloat(p.amount_per_member),
        total_amount: parseFloat(p.total_amount),
        transaction_fee_percent: parseFloat(p.transaction_fee_percent),
        transaction_fee: parseFloat(p.transaction_fee),
        grand_total: parseFloat(p.grand_total),
        status: p.status,
        paid_on: p.paid_on,
        payment_mode: p.payment_mode,
        reference_id: p.reference_id,
        notes: p.notes
      }))
    }, 'Payment history fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch payment history', 500, error);
  }
};

// ============================================================================
// API 6: ADMIN CLUBS VIEW - Lists all clubs with their dues status
// ============================================================================
const getAdminClubsView = async (req, res) => {
  try {
    const { rotary_year, status } = req.body;
    const targetYear = rotary_year || getCurrentRotaryYear();

    // Get config for this year
    const [config] = await pool.query(`
      SELECT amount, transaction_fee_percent
      FROM district_dues_config 
      WHERE rotary_year = ?
    `, [targetYear]);

    const amountPerMember = config.length > 0 ? parseFloat(config[0].amount) : 1000;
    const transactionFeePercent = config.length > 0 ? parseFloat(config[0].transaction_fee_percent) : 2.5;

    // Get all clubs from manchesterclub
    const [clubs] = await manchesterPool.query(`
      SELECT clubno, clubname 
      FROM clubdetails 
      ORDER BY clubname
    `);

    // Get all payments for this year
    const [payments] = await pool.query(`
      SELECT club_id, member_count, total_amount, transaction_fee, grand_total, status, paid_on, reference_id
      FROM district_dues_club_payments 
      WHERE rotary_year = ?
    `, [targetYear]);

    const paymentMap = new Map();
    for (const p of payments) {
      paymentMap.set(String(p.club_id), p);
    }

    // Build clubs list with dues info
    const clubsList = [];
    let totalCollected = 0;
    let totalPending = 0;
    let paidCount = 0;
    let pendingCount = 0;

    for (const club of clubs) {
      const clubId = String(club.clubno);
      const payment = paymentMap.get(clubId);

      // Get member count for this club
      const members = await getMembersByUserkey(clubId);
      const memberCount = members.length;

      const totalAmount = memberCount * amountPerMember;
      const transactionFee = (totalAmount * transactionFeePercent) / 100;
      const grandTotal = totalAmount + transactionFee;

      const clubStatus = payment ? payment.status : 'pending';

      if (clubStatus === 'paid') {
        totalCollected += parseFloat(payment.grand_total);
        paidCount++;
      } else {
        totalPending += grandTotal;
        pendingCount++;
      }

      // Apply status filter
      if (status && status !== 'all' && clubStatus !== status) {
        continue;
      }

      clubsList.push({
        club_id: clubId,
        club_name: club.clubname,
        member_count: memberCount,
        amount_per_member: amountPerMember,
        total_amount: totalAmount,
        transaction_fee: transactionFee,
        grand_total: grandTotal,
        status: clubStatus,
        paid_on: payment ? payment.paid_on : null,
        reference_id: payment ? payment.reference_id : null
      });
    }

    return apiResponse(res, true, {
      rotary_year: targetYear,
      config: {
        amount_per_member: amountPerMember,
        transaction_fee_percent: transactionFeePercent
      },
      summary: {
        total_clubs: clubs.length,
        paid_count: paidCount,
        pending_count: pendingCount,
        total_collected: totalCollected,
        total_pending: totalPending
      },
      clubs: clubsList
    }, 'Admin clubs view fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch admin clubs view', 500, error);
  }
};

module.exports = {
  getConfig,
  updateConfig,
  getClubSummary,
  payDues,
  getPaymentHistory,
  getAdminClubsView
};
