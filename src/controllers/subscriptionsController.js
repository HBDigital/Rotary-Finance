const pool = require('../config/database');
const { generateId, formatDateForDB, apiResponse, errorResponse, validateRequired, calculateBillingPeriod } = require('../utils/helpers');
const { getClubByUserkey, getMembersByUserkey } = require('../utils/clubHelper');

// List all subscriptions for a club
const getSubscriptions = async (req, res) => {
  try {
    const { userkey, status } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    let query = `
      SELECT 
        s.*,
        (SELECT COUNT(*) FROM subscription_members sm WHERE sm.subscription_id = s.id AND sm.status = 'active') as member_count
      FROM subscriptions s
      WHERE s.club_id = ?
    `;
    const params = [clubId];

    if (status && status !== 'all') {
      query += ` AND s.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY s.created_at DESC`;

    const [subscriptions] = await pool.query(query, params);

    return apiResponse(res, true, { subscriptions }, 'Subscriptions fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch subscriptions', 500, error);
  }
};

// Create a new subscription
const createSubscription = async (req, res) => {
  try {
    const {
      userkey,
      name,
      description,
      amount,
      frequency,
      collection_day,
      late_fee_enabled = false,
      late_fee_amount = 0,
      late_fee_after_days = 10,
      carry_forward_enabled = false,
      deactivation_date
    } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'name', 'amount', 'frequency', 'collection_day']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    const subscriptionId = generateId();

    await pool.query(`
      INSERT INTO subscriptions (
        id, club_id, name, description, amount, frequency, collection_day,
        late_fee_enabled, late_fee_amount, late_fee_after_days,
        carry_forward_enabled, deactivation_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `, [
      subscriptionId, clubId, name, description, amount, frequency, collection_day,
      late_fee_enabled, late_fee_amount, late_fee_after_days,
      carry_forward_enabled, formatDateForDB(deactivation_date)
    ]);

    const [subscription] = await pool.query('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);

    return apiResponse(res, true, { subscription: subscription[0] }, 'Subscription created successfully', 201);

  } catch (error) {
    return errorResponse(res, 'Failed to create subscription', 500, error);
  }
};

// Update subscription settings
const updateSubscription = async (req, res) => {
  try {
    const {
      userkey,
      subscription_id,
      name,
      description,
      amount,
      frequency,
      collection_day,
      late_fee_enabled,
      late_fee_amount,
      late_fee_after_days,
      carry_forward_enabled,
      deactivation_date
    } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'subscription_id']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    // Build dynamic update query
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (amount !== undefined) { updates.push('amount = ?'); params.push(amount); }
    if (frequency !== undefined) { updates.push('frequency = ?'); params.push(frequency); }
    if (collection_day !== undefined) { updates.push('collection_day = ?'); params.push(collection_day); }
    if (late_fee_enabled !== undefined) { updates.push('late_fee_enabled = ?'); params.push(late_fee_enabled); }
    if (late_fee_amount !== undefined) { updates.push('late_fee_amount = ?'); params.push(late_fee_amount); }
    if (late_fee_after_days !== undefined) { updates.push('late_fee_after_days = ?'); params.push(late_fee_after_days); }
    if (carry_forward_enabled !== undefined) { updates.push('carry_forward_enabled = ?'); params.push(carry_forward_enabled); }
    if (deactivation_date !== undefined) { updates.push('deactivation_date = ?'); params.push(formatDateForDB(deactivation_date)); }

    if (updates.length === 0) {
      return errorResponse(res, 'No fields to update', 400);
    }

    params.push(subscription_id, clubId);

    const [result] = await pool.query(`
      UPDATE subscriptions SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND club_id = ?
    `, params);

    if (result.affectedRows === 0) {
      return errorResponse(res, 'Subscription not found', 404);
    }

    const [subscription] = await pool.query('SELECT * FROM subscriptions WHERE id = ?', [subscription_id]);

    return apiResponse(res, true, { subscription: subscription[0] }, 'Subscription updated successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to update subscription', 500, error);
  }
};

// Deactivate a subscription
const deactivateSubscription = async (req, res) => {
  try {
    const { userkey, subscription_id } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'subscription_id']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    const [result] = await pool.query(`
      UPDATE subscriptions 
      SET status = 'inactive', deactivation_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND club_id = ?
    `, [subscription_id, clubId]);

    if (result.affectedRows === 0) {
      return errorResponse(res, 'Subscription not found', 404);
    }

    return apiResponse(res, true, null, 'Subscription deactivated successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to deactivate subscription', 500, error);
  }
};

// Get member transactions for a specific subscription
const getTransactions = async (req, res) => {
  try {
    const { userkey, subscription_id, status, search } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'subscription_id']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    // Get subscription details
    const [subscriptions] = await pool.query(`
      SELECT s.*, 
        (SELECT COUNT(*) FROM subscription_members sm WHERE sm.subscription_id = s.id AND sm.status = 'active') as member_count
      FROM subscriptions s 
      WHERE s.id = ? AND s.club_id = ?
    `, [subscription_id, clubId]);

    if (subscriptions.length === 0) {
      return errorResponse(res, 'Subscription not found', 404);
    }

    let query = `
      SELECT 
        st.id,
        st.member_id,
        m.name as member_name,
        m.email as member_email,
        m.phone as member_phone,
        st.billing_period_start,
        st.billing_period_end,
        st.amount,
        st.late_fee,
        st.total_amount,
        st.due_date,
        st.status,
        st.paid_on,
        st.payment_mode,
        st.reference_id,
        st.notes
      FROM subscription_transactions st
      JOIN members m ON st.member_id = m.id
      WHERE st.subscription_id = ?
    `;
    const params = [subscription_id];

    if (status && status !== 'all') {
      query += ` AND st.status = ?`;
      params.push(status);
    }

    if (search) {
      query += ` AND (m.name LIKE ? OR m.phone LIKE ? OR m.email LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY st.due_date DESC, m.name ASC`;

    const [transactions] = await pool.query(query, params);

    // Update status for overdue transactions
    const today = new Date();
    for (const txn of transactions) {
      if (txn.status === 'pending' && new Date(txn.due_date) < today) {
        txn.status = 'overdue';
        await pool.query('UPDATE subscription_transactions SET status = ? WHERE id = ?', ['overdue', txn.id]);
      }
    }

    // Get summary
    const [summary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT st.member_id) as total_members,
        SUM(CASE WHEN st.status = 'paid' THEN st.total_amount ELSE 0 END) as collected,
        SUM(CASE WHEN st.status = 'pending' THEN st.total_amount ELSE 0 END) as pending,
        SUM(CASE WHEN st.status = 'overdue' THEN 1 ELSE 0 END) as overdue_count
      FROM subscription_transactions st
      WHERE st.subscription_id = ?
    `, [subscription_id]);

    // Get all club members from manchesterclub database
    const allMembers = await getMembersByUserkey(userkey);

    // Get opted-out member IDs for this subscription (members who explicitly opted out)
    const [optedOutMembers] = await pool.query(`
      SELECT member_id FROM subscription_members WHERE subscription_id = ? AND status = 'inactive'
    `, [subscription_id]);
    const optedOutMemberIds = new Set(optedOutMembers.map(m => m.member_id));

    // Create a map of transactions by member_id for quick lookup
    const transactionMap = new Map();
    for (const txn of transactions) {
      transactionMap.set(txn.member_id, txn);
    }

    // Build members list with payment status
    // By default, all members are enrolled unless they explicitly opted out
    const members = allMembers.map(member => {
      const memberId = String(member.id);
      const isOptedOut = optedOutMemberIds.has(memberId);
      const isEnrolled = !isOptedOut; // Enrolled by default unless opted out
      const transaction = transactionMap.get(memberId);
      
      return {
        id: member.id,
        member_id: member.member_id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        is_enrolled: isEnrolled,
        payment_status: transaction ? transaction.status : (isEnrolled ? 'pending' : 'opted_out'),
        amount: transaction ? transaction.amount : (isEnrolled ? subscriptions[0].amount : null),
        total_amount: transaction ? transaction.total_amount : (isEnrolled ? subscriptions[0].amount : null),
        late_fee: transaction ? transaction.late_fee : null,
        due_date: transaction ? transaction.due_date : null,
        paid_on: transaction ? transaction.paid_on : null,
        payment_mode: transaction ? transaction.payment_mode : null,
        reference_id: transaction ? transaction.reference_id : null,
        billing_period_start: transaction ? transaction.billing_period_start : null,
        billing_period_end: transaction ? transaction.billing_period_end : null
      };
    });

    // Apply search filter to members if provided
    let filteredMembers = members;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredMembers = members.filter(m => 
        (m.name && m.name.toLowerCase().includes(searchLower)) ||
        (m.email && m.email.toLowerCase().includes(searchLower)) ||
        (m.phone && m.phone.includes(search))
      );
    }

    // Apply status filter to members if provided
    if (status && status !== 'all') {
      filteredMembers = filteredMembers.filter(m => m.payment_status === status);
    }

    // Calculate enrolled count (all members minus opted out)
    const enrolledCount = allMembers.length - optedOutMemberIds.size;

    return apiResponse(res, true, {
      subscription: subscriptions[0],
      summary: {
        total_club_members: allMembers.length,
        enrolled_members: enrolledCount,
        opted_out_members: optedOutMemberIds.size,
        total_transactions: summary[0].total_members || 0,
        collected: parseFloat(summary[0].collected) || 0,
        pending: parseFloat(summary[0].pending) || 0,
        overdue_count: summary[0].overdue_count || 0
      },
      members: filteredMembers,
      transactions
    }, 'Transactions fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch transactions', 500, error);
  }
};

// Mark subscription payment as paid
const markTransactionPaid = async (req, res) => {
  try {
    const { userkey, subscription_id, member_id, paid_on, payment_mode, reference_id, notes, amount } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'subscription_id', 'member_id', 'paid_on']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey;

    // Get subscription details
    const [subscriptions] = await pool.query(
      'SELECT * FROM subscriptions WHERE id = ? AND club_id = ?',
      [subscription_id, clubId]
    );
    if (subscriptions.length === 0) {
      return errorResponse(res, 'Subscription not found', 404);
    }
    const subscription = subscriptions[0];

    // Calculate billing period
    const billingPeriod = calculateBillingPeriod(subscription.frequency, subscription.collection_day);

    // Check if transaction exists for this member and billing period
    const [existingTxn] = await pool.query(`
      SELECT id FROM subscription_transactions 
      WHERE subscription_id = ? AND member_id = ? AND billing_period_start = ?
    `, [subscription_id, member_id, billingPeriod.start]);

    const txnAmount = amount || subscription.amount;

    if (existingTxn.length > 0) {
      // Update existing transaction
      await pool.query(`
        UPDATE subscription_transactions 
        SET status = 'paid', 
            paid_on = ?, 
            payment_mode = ?, 
            reference_id = ?, 
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [formatDateForDB(paid_on), payment_mode, reference_id, notes, existingTxn[0].id]);
    } else {
      // Create new transaction record (member is enrolled by default)
      await pool.query(`
        INSERT INTO subscription_transactions 
        (id, subscription_id, member_id, billing_period_start, billing_period_end, amount, late_fee, total_amount, due_date, status, paid_on, payment_mode, reference_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'paid', ?, ?, ?, ?)
      `, [
        generateId(), subscription_id, member_id, 
        billingPeriod.start, billingPeriod.end, 
        txnAmount, txnAmount, billingPeriod.start,
        formatDateForDB(paid_on), payment_mode, reference_id, notes
      ]);
    }

    return apiResponse(res, true, null, 'Payment marked as paid successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to mark payment as paid', 500, error);
  }
};

// Add members to a subscription
const addMembers = async (req, res) => {
  try {
    const { userkey, subscription_id, member_ids } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'subscription_id', 'member_ids']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    if (!Array.isArray(member_ids) || member_ids.length === 0) {
      return errorResponse(res, 'member_ids must be a non-empty array', 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    // Get subscription
    const [subscriptions] = await pool.query(
      'SELECT * FROM subscriptions WHERE id = ? AND club_id = ?',
      [subscription_id, clubId]
    );
    if (subscriptions.length === 0) {
      return errorResponse(res, 'Subscription not found', 404);
    }
    const subscription = subscriptions[0];

    // Add members to subscription
    const memberInserts = member_ids.map(memberId => [
      generateId(),
      subscription_id,
      memberId,
      'active'
    ]);

    await pool.query(`
      INSERT IGNORE INTO subscription_members (id, subscription_id, member_id, status)
      VALUES ?
    `, [memberInserts]);

    // Create initial transactions for new members
    const billingPeriod = calculateBillingPeriod(subscription.frequency);
    const dueDate = new Date();
    dueDate.setDate(subscription.collection_day);

    const transactionInserts = member_ids.map(memberId => [
      generateId(),
      subscription_id,
      memberId,
      formatDateForDB(billingPeriod.start),
      formatDateForDB(billingPeriod.end),
      subscription.amount,
      0,
      subscription.amount,
      formatDateForDB(dueDate),
      'pending'
    ]);

    await pool.query(`
      INSERT IGNORE INTO subscription_transactions 
      (id, subscription_id, member_id, billing_period_start, billing_period_end, amount, late_fee, total_amount, due_date, status)
      VALUES ?
    `, [transactionInserts]);

    return apiResponse(res, true, {
      added_count: member_ids.length
    }, `${member_ids.length} members added to subscription`);

  } catch (error) {
    return errorResponse(res, 'Failed to add members', 500, error);
  }
};

module.exports = {
  getSubscriptions,
  createSubscription,
  updateSubscription,
  deactivateSubscription,
  getTransactions,
  markTransactionPaid,
  addMembers
};
