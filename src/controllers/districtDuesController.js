const pool = require('../config/database');
const manchesterPool = require('../config/manchesterDb');
const { generateId, formatDateForDB, apiResponse, errorResponse, validateRequired, calculateStatus } = require('../utils/helpers');
const { getClubByUserkey, getMembersByUserkey } = require('../utils/clubHelper');

// Get all district dues for a club
const getDistrictDues = async (req, res) => {
  try {
    const { userkey, rotary_year, status, search } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    // Get current rotary year
    const [rotaryYears] = await pool.query(
      rotary_year 
        ? 'SELECT id, year_label FROM rotary_years WHERE year_label = ?' 
        : 'SELECT id, year_label FROM rotary_years WHERE is_current = TRUE',
      rotary_year ? [rotary_year] : []
    );
    if (rotaryYears.length === 0) {
      return errorResponse(res, 'Rotary year not found', 404);
    }
    const rotaryYearId = rotaryYears[0].id;
    const rotaryYearLabel = rotaryYears[0].year_label;

    // Get dues config for this club and year
    const [duesConfig] = await pool.query(`
      SELECT amount, due_date FROM district_dues_config 
      WHERE club_id = ? AND rotary_year_id = ?
    `, [clubId, rotaryYearId]);
    const defaultAmount = duesConfig.length > 0 ? duesConfig[0].amount : 1000;
    const defaultDueDate = duesConfig.length > 0 ? duesConfig[0].due_date : null;

    // Get all club members from manchesterclub database
    const allMembers = await getMembersByUserkey(userkey);

    // Get existing payments for this club and rotary year
    const [payments] = await pool.query(`
      SELECT 
        ddp.id,
        ddp.member_id,
        ddp.amount,
        ddp.due_date,
        ddp.status,
        ddp.paid_on,
        ddp.payment_mode,
        ddp.reference_id,
        ddp.notes,
        ddp.reminder_sent_at
      FROM district_dues_payments ddp
      WHERE ddp.club_id = ? AND ddp.rotary_year_id = ?
    `, [clubId, rotaryYearId]);

    // Create a map of payments by member_id
    const paymentMap = new Map();
    for (const payment of payments) {
      paymentMap.set(String(payment.member_id), payment);
    }

    // Build members list with payment status (all members enrolled by default)
    const today = new Date();
    let members = allMembers.map(member => {
      const memberId = String(member.id);
      const payment = paymentMap.get(memberId);
      
      let paymentStatus = 'pending';
      if (payment) {
        paymentStatus = payment.status;
        // Check if overdue
        if (paymentStatus === 'pending' && payment.due_date && new Date(payment.due_date) < today) {
          paymentStatus = 'overdue';
        }
      } else if (defaultDueDate && new Date(defaultDueDate) < today) {
        paymentStatus = 'overdue';
      }

      return {
        id: payment ? payment.id : null,
        member_id: member.id,
        member_name: member.name,
        member_email: member.email,
        member_phone: member.phone,
        amount: payment ? payment.amount : defaultAmount,
        due_date: payment ? payment.due_date : defaultDueDate,
        status: paymentStatus,
        paid_on: payment ? payment.paid_on : null,
        payment_mode: payment ? payment.payment_mode : null,
        reference_id: payment ? payment.reference_id : null,
        notes: payment ? payment.notes : null,
        reminder_sent_at: payment ? payment.reminder_sent_at : null,
        rotary_year: rotaryYearLabel
      };
    });

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      members = members.filter(m => 
        (m.member_name && m.member_name.toLowerCase().includes(searchLower)) ||
        (m.member_email && m.member_email.toLowerCase().includes(searchLower)) ||
        (m.member_phone && m.member_phone.includes(search))
      );
    }

    // Apply status filter
    if (status && status !== 'all') {
      members = members.filter(m => m.status === status);
    }

    // Calculate summary
    const totalMembers = allMembers.length;
    const paidMembers = members.filter(m => m.status === 'paid');
    const pendingMembers = members.filter(m => m.status === 'pending');
    const overdueMembers = members.filter(m => m.status === 'overdue');
    
    const collected = paidMembers.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
    const pending = pendingMembers.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0) + 
                    overdueMembers.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);

    return apiResponse(res, true, {
      config: {
        amount: defaultAmount,
        due_date: defaultDueDate
      },
      summary: {
        total_club_members: totalMembers,
        paid_count: paidMembers.length,
        pending_count: pendingMembers.length,
        overdue_count: overdueMembers.length,
        collected: collected,
        pending: pending
      },
      members
    }, 'District dues fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch district dues', 500, error);
  }
};

// Mark district dues as paid
const markAsPaid = async (req, res) => {
  try {
    const { userkey, member_id, paid_on, payment_mode, reference_id, notes, amount } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'member_id', 'paid_on']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

    // Get current rotary year
    const [rotaryYears] = await pool.query('SELECT id FROM rotary_years WHERE is_current = TRUE');
    if (rotaryYears.length === 0) {
      return errorResponse(res, 'No current rotary year found', 404);
    }
    const rotaryYearId = rotaryYears[0].id;

    // Check if payment record exists
    const [existingPayment] = await pool.query(`
      SELECT id FROM district_dues_payments 
      WHERE club_id = ? AND member_id = ? AND rotary_year_id = ?
    `, [clubId, member_id, rotaryYearId]);

    if (existingPayment.length > 0) {
      // Update existing payment record
      await pool.query(`
        UPDATE district_dues_payments 
        SET status = 'paid', 
            paid_on = ?, 
            payment_mode = ?, 
            reference_id = ?, 
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE club_id = ? AND member_id = ? AND rotary_year_id = ?
      `, [formatDateForDB(paid_on), payment_mode, reference_id, notes, clubId, member_id, rotaryYearId]);
    } else {
      // Create new payment record (member is enrolled by default)
      // Get dues config for amount, or use provided amount, or default
      const [duesConfig] = await pool.query(`
        SELECT amount, due_date FROM district_dues_config 
        WHERE club_id = ? AND rotary_year_id = ?
      `, [clubId, rotaryYearId]);
      
      const duesAmount = amount || (duesConfig.length > 0 ? duesConfig[0].amount : 1000);
      const dueDate = duesConfig.length > 0 ? duesConfig[0].due_date : new Date();

      await pool.query(`
        INSERT INTO district_dues_payments 
        (id, club_id, member_id, rotary_year_id, amount, due_date, status, paid_on, payment_mode, reference_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
      `, [generateId(), clubId, member_id, rotaryYearId, duesAmount, dueDate, formatDateForDB(paid_on), payment_mode, reference_id, notes]);
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

    // Verify club exists in manchesterclub database
    const club = await getClubByUserkey(userkey);
    if (!club) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = userkey; // Use userkey as club_id

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
