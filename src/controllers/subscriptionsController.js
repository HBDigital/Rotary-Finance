const pool = require('../config/database');
const { generateId, formatDateForDB, apiResponse, errorResponse, validateRequired, calculateBillingPeriod } = require('../utils/helpers');

// List all subscriptions for a club
const getSubscriptions = async (req, res) => {
  try {
    const { userkey, status } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

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

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

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

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

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

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

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

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

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

    return apiResponse(res, true, {
      subscription: subscriptions[0],
      summary: {
        total_members: summary[0].total_members || 0,
        collected: parseFloat(summary[0].collected) || 0,
        pending: parseFloat(summary[0].pending) || 0,
        overdue_count: summary[0].overdue_count || 0
      },
      transactions
    }, 'Transactions fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch transactions', 500, error);
  }
};

// Mark subscription payment as paid
const markTransactionPaid = async (req, res) => {
  try {
    const { userkey, transaction_id, paid_on, payment_mode, reference_id, notes } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'transaction_id', 'paid_on']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }

    const [result] = await pool.query(`
      UPDATE subscription_transactions 
      SET status = 'paid', 
          paid_on = ?, 
          payment_mode = ?, 
          reference_id = ?, 
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [formatDateForDB(paid_on), payment_mode, reference_id, notes, transaction_id]);

    if (result.affectedRows === 0) {
      return errorResponse(res, 'Transaction not found', 404);
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

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

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
