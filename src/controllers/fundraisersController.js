const pool = require('../config/database');
const { generateId, formatDateForDB, apiResponse, errorResponse, validateRequired } = require('../utils/helpers');

// List all fundraisers for a club
const getFundraisers = async (req, res) => {
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
        f.*,
        (SELECT COUNT(*) FROM fundraiser_donations fd WHERE fd.fundraiser_id = f.id) as donor_count,
        ROUND((f.raised_amount / f.target_amount) * 100, 0) as progress_percentage
      FROM fundraisers f
      WHERE f.club_id = ?
    `;
    const params = [clubId];

    if (status && status !== 'all') {
      query += ` AND f.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY f.created_at DESC`;

    const [fundraisers] = await pool.query(query, params);

    return apiResponse(res, true, { fundraisers }, 'Fundraisers fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch fundraisers', 500, error);
  }
};

// Create a new fundraiser
const createFundraiser = async (req, res) => {
  try {
    const {
      userkey,
      title,
      description,
      cover_photo_url,
      target_amount,
      start_date,
      end_date,
      allow_anonymous = true,
      show_supporters_publicly = true,
      thank_you_message
    } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'title', 'target_amount', 'start_date', 'end_date']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    const fundraiserId = generateId();

    await pool.query(`
      INSERT INTO fundraisers (
        id, club_id, title, description, cover_photo_url, target_amount,
        start_date, end_date, allow_anonymous, show_supporters_publicly, thank_you_message, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `, [
      fundraiserId, clubId, title, description, cover_photo_url, target_amount,
      formatDateForDB(start_date), formatDateForDB(end_date),
      allow_anonymous, show_supporters_publicly, thank_you_message
    ]);

    const [fundraiser] = await pool.query('SELECT * FROM fundraisers WHERE id = ?', [fundraiserId]);

    return apiResponse(res, true, { fundraiser: fundraiser[0] }, 'Fundraiser created successfully', 201);

  } catch (error) {
    return errorResponse(res, 'Failed to create fundraiser', 500, error);
  }
};

// Update fundraiser details
const updateFundraiser = async (req, res) => {
  try {
    const {
      userkey,
      fundraiser_id,
      title,
      description,
      cover_photo_url,
      target_amount,
      start_date,
      end_date,
      status,
      allow_anonymous,
      show_supporters_publicly,
      thank_you_message
    } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'fundraiser_id']);
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

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (cover_photo_url !== undefined) { updates.push('cover_photo_url = ?'); params.push(cover_photo_url); }
    if (target_amount !== undefined) { updates.push('target_amount = ?'); params.push(target_amount); }
    if (start_date !== undefined) { updates.push('start_date = ?'); params.push(formatDateForDB(start_date)); }
    if (end_date !== undefined) { updates.push('end_date = ?'); params.push(formatDateForDB(end_date)); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (allow_anonymous !== undefined) { updates.push('allow_anonymous = ?'); params.push(allow_anonymous); }
    if (show_supporters_publicly !== undefined) { updates.push('show_supporters_publicly = ?'); params.push(show_supporters_publicly); }
    if (thank_you_message !== undefined) { updates.push('thank_you_message = ?'); params.push(thank_you_message); }

    if (updates.length === 0) {
      return errorResponse(res, 'No fields to update', 400);
    }

    params.push(fundraiser_id, clubId);

    const [result] = await pool.query(`
      UPDATE fundraisers SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND club_id = ?
    `, params);

    if (result.affectedRows === 0) {
      return errorResponse(res, 'Fundraiser not found', 404);
    }

    const [fundraiser] = await pool.query('SELECT * FROM fundraisers WHERE id = ?', [fundraiser_id]);

    return apiResponse(res, true, { fundraiser: fundraiser[0] }, 'Fundraiser updated successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to update fundraiser', 500, error);
  }
};

// Get donations/supporters for a fundraiser
const getDonations = async (req, res) => {
  try {
    const { userkey, fundraiser_id } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'fundraiser_id']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // Get fundraiser details
    const [fundraisers] = await pool.query(`
      SELECT f.*,
        (SELECT COUNT(*) FROM fundraiser_donations fd WHERE fd.fundraiser_id = f.id) as donor_count,
        ROUND((f.raised_amount / f.target_amount) * 100, 0) as progress_percentage
      FROM fundraisers f
      WHERE f.id = ? AND f.club_id = ?
    `, [fundraiser_id, clubId]);

    if (fundraisers.length === 0) {
      return errorResponse(res, 'Fundraiser not found', 404);
    }

    // Get donations
    const [donations] = await pool.query(`
      SELECT 
        fd.id,
        CASE WHEN fd.is_anonymous THEN 'Anonymous' ELSE fd.donor_name END as donor_name,
        fd.amount,
        fd.is_anonymous,
        fd.donated_at,
        fd.payment_mode,
        m.name as member_name,
        rm.name as referred_by_name
      FROM fundraiser_donations fd
      LEFT JOIN members m ON fd.member_id = m.id
      LEFT JOIN members rm ON fd.referred_by_member_id = rm.id
      WHERE fd.fundraiser_id = ?
      ORDER BY fd.donated_at DESC
    `, [fundraiser_id]);

    return apiResponse(res, true, {
      fundraiser: fundraisers[0],
      donations
    }, 'Donations fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch donations', 500, error);
  }
};

// Record a new donation
const addDonation = async (req, res) => {
  try {
    const {
      userkey,
      fundraiser_id,
      donor_name,
      donor_email,
      donor_phone,
      member_id,
      amount,
      is_anonymous = false,
      payment_mode,
      reference_id,
      notes,
      referred_by_member_id
    } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'fundraiser_id', 'amount']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // Verify fundraiser exists
    const [fundraisers] = await pool.query(
      'SELECT * FROM fundraisers WHERE id = ? AND club_id = ?',
      [fundraiser_id, clubId]
    );
    if (fundraisers.length === 0) {
      return errorResponse(res, 'Fundraiser not found', 404);
    }

    const donationId = generateId();

    await pool.query(`
      INSERT INTO fundraiser_donations (
        id, fundraiser_id, donor_name, donor_email, donor_phone, member_id,
        amount, is_anonymous, payment_mode, reference_id, notes, referred_by_member_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      donationId, fundraiser_id, donor_name, donor_email, donor_phone, member_id,
      amount, is_anonymous, payment_mode, reference_id, notes, referred_by_member_id
    ]);

    // Update raised amount in fundraiser
    await pool.query(`
      UPDATE fundraisers 
      SET raised_amount = raised_amount + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [amount, fundraiser_id]);

    // Update social sharing stats if referred
    if (referred_by_member_id) {
      await pool.query(`
        UPDATE fundraiser_shares 
        SET donation_count = donation_count + 1, 
            total_raised = total_raised + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE fundraiser_id = ? AND member_id = ?
      `, [amount, fundraiser_id, referred_by_member_id]);
    }

    const [donation] = await pool.query('SELECT * FROM fundraiser_donations WHERE id = ?', [donationId]);

    return apiResponse(res, true, { donation: donation[0] }, 'Donation recorded successfully', 201);

  } catch (error) {
    return errorResponse(res, 'Failed to record donation', 500, error);
  }
};

// Get social sharing leaderboard data
const getSharingStats = async (req, res) => {
  try {
    const { userkey, fundraiser_id } = req.body;

    const validation = validateRequired(req.body, ['userkey', 'fundraiser_id']);
    if (!validation.valid) {
      return errorResponse(res, `Missing required fields: ${validation.missing.join(', ')}`, 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // Verify fundraiser exists
    const [fundraisers] = await pool.query(
      'SELECT * FROM fundraisers WHERE id = ? AND club_id = ?',
      [fundraiser_id, clubId]
    );
    if (fundraisers.length === 0) {
      return errorResponse(res, 'Fundraiser not found', 404);
    }

    // Get sharing leaderboard
    const [leaderboard] = await pool.query(`
      SELECT 
        fs.id,
        fs.member_id,
        m.name as member_name,
        fs.donation_count,
        fs.total_raised,
        fs.click_count,
        fs.share_platform,
        fs.created_at
      FROM fundraiser_shares fs
      JOIN members m ON fs.member_id = m.id
      WHERE fs.fundraiser_id = ?
      ORDER BY fs.donation_count DESC, fs.total_raised DESC
      LIMIT 20
    `, [fundraiser_id]);

    return apiResponse(res, true, {
      fundraiser: fundraisers[0],
      leaderboard
    }, 'Sharing stats fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch sharing stats', 500, error);
  }
};

module.exports = {
  getFundraisers,
  createFundraiser,
  updateFundraiser,
  getDonations,
  addDonation,
  getSharingStats
};
