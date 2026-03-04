const manchesterPool = require('../config/manchesterDb');

// Get club by userkey from manchesterclub database
const getClubByUserkey = async (userkey) => {
  const [clubs] = await manchesterPool.query(`
    SELECT 
      id,
      clubname as club_name,
      clubno as club_no
    FROM clubdetails 
    WHERE clubno = ?
  `, [userkey]);
  
  return clubs.length > 0 ? clubs[0] : null;
};

// Get members by userkey from manchesterclub database
const getMembersByUserkey = async (userkey) => {
  const [members] = await manchesterPool.query(`
    SELECT 
      id,
      memberid as member_id,
      name,
      email,
      mobile as phone
    FROM userprofile 
    WHERE memberkey = ? AND isDeleted = 0
    ORDER BY name ASC
  `, [userkey]);
  
  return members;
};

// Get single member by id and userkey
const getMemberById = async (userkey, memberId) => {
  const [members] = await manchesterPool.query(`
    SELECT 
      id,
      memberid as member_id,
      name,
      email,
      mobile as phone
    FROM userprofile 
    WHERE memberkey = ? AND id = ? AND isDeleted = 0
  `, [userkey, memberId]);
  
  return members.length > 0 ? members[0] : null;
};

module.exports = {
  getClubByUserkey,
  getMembersByUserkey,
  getMemberById
};
