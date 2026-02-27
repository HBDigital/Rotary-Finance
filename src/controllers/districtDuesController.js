const pool = require('../config/database');
const { generateId, formatDateForDB, apiResponse, errorResponse, validateRequired, calculateStatus } = require('../utils/helpers');

// Get all district dues for a club
const getDistrictDues = async (req, res) => {
  try {
    const { userkey, rotary_year, status, search } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    // Get club by userkey
    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // Get rotary year (default to current)
    let rotaryYearCondition = 'ry.is_current = TRUE';
    if (rotary_year) {
      rotaryYearCondition = 'ry.year_label = ?';
    }

    let query = `
      SELECT 
        ddp.id,
        ddp.member_id,
        m.name as member_name,
        m.email as member_email,
        m.phone as member_phone,
        ddp.amount,
        ddp.due_date,
        ddp.status,
        ddp.paid_on,
        ddp.payment_mode,
        ddp.reference_id,
        ddp.notes,
        ddp.reminder_sent_at,
        ry.year_label as rotary_year
      FROM district_dues_payments ddp
      JOIN members m ON ddp.member_id = m.id
      JOIN rotary_years ry ON ddp.rotary_year_id = ry.id
      WHERE ddp.club_id = ?
    `;

    const params = [clubId];

    if (rotary_year) {
      query += ` AND ry.year_label = ?`;
      params.push(rotary_year);
    } else {
      query += ` AND ry.is_current = TRUE`;
    }

    if (status && status !== 'all') {
      query += ` AND ddp.status = ?`;
      params.push(status);
    }

    if (search) {
      query += ` AND (m.name LIKE ? OR m.phone LIKE ? OR m.email LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY m.name ASC`;

    const [payments] = await pool.query(query, params);

    // Update status for overdue payments
    const today = new Date();
    for (const payment of payments) {
      if (payment.status === 'pending' && new Date(payment.due_date) < today) {
        payment.status = 'overdue';
        await pool.query('UPDATE district_dues_payments SET status = ? WHERE id = ?', ['overdue', payment.id]);
      }
    }

    // Get summary
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_members,
        SUM(CASE WHEN ddp.status = 'paid' THEN ddp.amount ELSE 0 END) as collected,
        SUM(CASE WHEN ddp.status = 'pending' THEN ddp.amount ELSE 0 END) as pending,
        SUM(CASE WHEN ddp.status = 'overdue' THEN 1 ELSE 0 END) as overdue_count
      FROM district_dues_payments ddp
      JOIN rotary_years ry ON ddp.rotary_year_id = ry.id
      WHERE ddp.club_id = ? AND ${rotary_year ? 'ry.year_label = ?' : 'ry.is_current = TRUE'}
    `, rotary_year ? [clubId, rotary_year] : [clubId]);

    return apiResponse(res, true, {
      summary: {
        total_members: summary[0].total_members || 0,
        collected: parseFloat(summary[0].collected) || 0,
        pending: parseFloat(summary[0].pending) || 0,
        overdue_count: summary[0].overdue_count || 0
      },
      payments
    }, 'District dues fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch district dues', 500, error);
  }
};

// Mark district dues as paid
const markAsPaid = async (req, res) => {
  try {
    const { userkey, member_id, paid_on, payment_mode, reference_id, notes } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'member_id', 'paid_on']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Get club by userkey
    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // Get current rotary year
    const [rotaryYears] = await pool.query('SELECT id FROM rotary_years WHERE is_current = TRUE');
    if (rotaryYears.length === 0) {
      return errorResponse(res, 'No current rotary year found', 404);
    }

    // Update payment
    const [result] = await pool.query(`
      UPDATE district_dues_payments 
      SET status = 'paid', 
          paid_on = ?, 
          payment_mode = ?, 
          reference_id = ?, 
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE club_id = ? AND member_id = ? AND rotary_year_id = ?
    `, [formatDateForDB(paid_on), payment_mode, reference_id, notes, clubId, member_id, rotaryYears[0].id]);

    if (result.affectedRows === 0) {
      return errorResponse(res, 'Payment record not found', 404);
    }

    return apiResponse(res, true, null, 'Payment marked as paid successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to mark payment as paid', 500, error);
  }
};

// Send payment reminder
const sendReminder = async (req, res) => {
  try {
    const { userkey, member_ids, reminder_type = 'email' } = req.body;

    const validation = validateRequired(req.body, ['userkey']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Get club by userkey
    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // Get current rotary year
    const [rotaryYears] = await pool.query('SELECT id FROM rotary_years WHERE is_current = TRUE');
    if (rotaryYears.length === 0) {
      return errorResponse(res, 'No current rotary year found', 404);
    }

    // Get pending/overdue members
    let query = `
      SELECT ddp.id, ddp.member_id, m.name, m.email, m.phone, ddp.amount, ddp.due_date
      FROM district_dues_payments ddp
      JOIN members m ON ddp.member_id = m.id
      WHERE ddp.club_id = ? AND ddp.rotary_year_id = ? AND ddp.status IN ('pending', 'overdue')
    `;
    const params = [clubId, rotaryYears[0].id];

    if (member_ids && member_ids.length > 0) {
      query += ` AND ddp.member_id IN (?)`;
      params.push(member_ids);
    }

    const [members] = await pool.query(query, params);

    if (members.length === 0) {
      return apiResponse(res, true, { sent_count: 0 }, 'No pending payments to remind');
    }

    // Log reminders (actual sending would integrate with notification service)
    const reminderLogs = members.map(member => [
      generateId(),
      clubId,
      'district_dues',
      member.id,
      member.member_id,
      reminder_type,
      'sent'
    ]);

    await pool.query(`
      INSERT INTO reminder_logs (id, club_id, reminder_type, reference_id, member_id, sent_via, status)
      VALUES ?
    `, [reminderLogs]);

    // Update reminder_sent_at
    const memberIdList = members.map(m => m.member_id);
    await pool.query(`
      UPDATE district_dues_payments 
      SET reminder_sent_at = CURRENT_TIMESTAMP 
      WHERE club_id = ? AND member_id IN (?) AND rotary_year_id = ?
    `, [clubId, memberIdList, rotaryYears[0].id]);

    return apiResponse(res, true, {
      sent_count: members.length,
      members: members.map(m => ({ id: m.member_id, name: m.name, email: m.email }))
    }, `Reminders sent to ${members.length} members`);

  } catch (error) {
    return errorResponse(res, 'Failed to send reminders', 500, error);
  }
};

module.exports = {
  getDistrictDues,
  markAsPaid,
  sendReminder
};
