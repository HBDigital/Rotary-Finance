const pool = require('../config/database');
const { apiResponse, errorResponse } = require('../utils/helpers');

// Get aggregated finance summary
const getFinanceSummary = async (req, res) => {
  try {
    const { userkey } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }
    const clubId = clubs[0].id;

    // District Dues Summary (current year)
    const [duesSummary] = await pool.query(`
      SELECT 
        COUNT(*) as total_members,
        SUM(CASE WHEN ddp.status = 'paid' THEN ddp.amount ELSE 0 END) as collected,
        SUM(CASE WHEN ddp.status IN ('pending', 'overdue') THEN ddp.amount ELSE 0 END) as pending,
        SUM(CASE WHEN ddp.status = 'overdue' THEN 1 ELSE 0 END) as overdue_count
      FROM district_dues_payments ddp
      JOIN rotary_years ry ON ddp.rotary_year_id = ry.id
      WHERE ddp.club_id = ? AND ry.is_current = TRUE
    `, [clubId]);

    // Subscriptions Summary
    const [subscriptionsSummary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT s.id) as total_subscriptions,
        COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.id END) as active_subscriptions,
        COALESCE(SUM(CASE WHEN st.status = 'paid' THEN st.total_amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN st.status IN ('pending', 'overdue') THEN st.total_amount ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN st.status = 'overdue' THEN 1 ELSE 0 END), 0) as overdue_count
      FROM subscriptions s
      LEFT JOIN subscription_transactions st ON s.id = st.subscription_id
      WHERE s.club_id = ?
    `, [clubId]);

    // Fundraisers Summary
    const [fundraisersSummary] = await pool.query(`
      SELECT 
        COUNT(*) as total_fundraisers,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_fundraisers,
        COALESCE(SUM(raised_amount), 0) as total_raised,
        COALESCE(SUM(target_amount), 0) as total_target
      FROM fundraisers
      WHERE club_id = ?
    `, [clubId]);

    // Calculate totals
    const districtDues = {
      total_members: duesSummary[0].total_members || 0,
      collected: parseFloat(duesSummary[0].collected) || 0,
      pending: parseFloat(duesSummary[0].pending) || 0,
      overdue_count: duesSummary[0].overdue_count || 0
    };

    const subscriptions = {
      total_subscriptions: subscriptionsSummary[0].total_subscriptions || 0,
      active_subscriptions: subscriptionsSummary[0].active_subscriptions || 0,
      collected: parseFloat(subscriptionsSummary[0].collected) || 0,
      pending: parseFloat(subscriptionsSummary[0].pending) || 0,
      overdue_count: subscriptionsSummary[0].overdue_count || 0
    };

    const fundraisers = {
      total_fundraisers: fundraisersSummary[0].total_fundraisers || 0,
      active_fundraisers: fundraisersSummary[0].active_fundraisers || 0,
      total_raised: parseFloat(fundraisersSummary[0].total_raised) || 0,
      total_target: parseFloat(fundraisersSummary[0].total_target) || 0
    };

    const overall = {
      total_collected: districtDues.collected + subscriptions.collected + fundraisers.total_raised,
      total_pending: districtDues.pending + subscriptions.pending,
      total_overdue_count: districtDues.overdue_count + subscriptions.overdue_count
    };

    return apiResponse(res, true, {
      district_dues: districtDues,
      subscriptions,
      fundraisers,
      overall
    }, 'Finance summary fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch finance summary', 500, error);
  }
};

module.exports = {
  getFinanceSummary
};
