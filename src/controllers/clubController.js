const manchesterPool = require('../config/manchesterDb');
const { apiResponse, errorResponse } = require('../utils/helpers');

// Get club details by userkey
const getClubDetails = async (req, res) => {
  try {
    const { userkey } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    const [clubs] = await manchesterPool.query(`
      SELECT 
        id,
        clubname as club_name,
        clubno as club_no,
        Starteddate as started_date,
        sponsoredby as sponsored_by,
        clubSponsored as club_sponsored,
        ChairPerson as chair_person,
        guidinglion as guiding_lion,
        clublogo as club_logo,
        isActive as is_active,
        created_on,
        modified_on
      FROM clubdetails 
      WHERE clubno = ?
    `, [userkey]);

    if (clubs.length === 0) {
      return errorResponse(res, 'Club not found', 404);
    }

    return apiResponse(res, true, { club: clubs[0] }, 'Club details fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch club details', 500, error);
  }
};

// Get members list by userkey
const getMembersList = async (req, res) => {
  try {
    const { userkey, search, is_active } = req.body;

    if (!userkey) {
      return errorResponse(res, 'userkey is required', 400);
    }

    let query = `
      SELECT 
        id,
        memberid as member_id,
        memberkey as member_key,
        name,
        email,
        mobile as phone,
        dob,
        bloodgroup as blood_group,
        gender,
        anniversary,
        address,
        district,
        spousename as spouse_name,
        clubname as club_name,
        designation,
        ranking,
        image as profile_image,
        isActive as is_active,
        isDeleted as is_deleted,
        linkedin,
        facebook,
        instagram,
        website
      FROM userprofile 
      WHERE memberkey = ? AND isDeleted = 0
    `;
    const params = [userkey];

    if (is_active !== undefined) {
      query += ` AND isActive = ?`;
      params.push(is_active ? 1 : 0);
    }

    if (search) {
      query += ` AND (name LIKE ? OR email LIKE ? OR mobile LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY name ASC`;

    const [members] = await manchesterPool.query(query, params);

    // Get club details
    const [clubs] = await manchesterPool.query(`
      SELECT clubname as club_name, clubno as club_no 
      FROM clubdetails 
      WHERE clubno = ?
    `, [userkey]);

    return apiResponse(res, true, {
      club: clubs[0] || null,
      total_members: members.length,
      members
    }, 'Members list fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch members list', 500, error);
  }
};

// Get single member details
const getMemberDetails = async (req, res) => {
  try {
    const { userkey, member_id } = req.body;

    if (!userkey || !member_id) {
      return errorResponse(res, 'userkey and member_id are required', 400);
    }

    const [members] = await manchesterPool.query(`
      SELECT 
        id,
        memberid as member_id,
        memberkey as member_key,
        name,
        email,
        mobile as phone,
        dob,
        age,
        bloodgroup as blood_group,
        gender,
        anniversary,
        nationality,
        address,
        district,
        location,
        spousename as spouse_name,
        spouseage as spouse_age,
        spousedob as spouse_dob,
        spousebloodgrp as spouse_blood_group,
        category,
        subcategory,
        clubname as club_name,
        industrialname as industrial_name,
        designation,
        ranking,
        image as profile_image,
        isActive as is_active,
        linkedin,
        facebook,
        instagram,
        website
      FROM userprofile 
      WHERE memberkey = ? AND id = ?
    `, [userkey, member_id]);

    if (members.length === 0) {
      return errorResponse(res, 'Member not found', 404);
    }

    return apiResponse(res, true, { member: members[0] }, 'Member details fetched successfully');

  } catch (error) {
    return errorResponse(res, 'Failed to fetch member details', 500, error);
  }
};

module.exports = {
  getClubDetails,
  getMembersList,
  getMemberDetails
};
