const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.example') });
const pool = require('../config/database');
const { generateId, formatDateForDB } = require('../utils/helpers');

async function seedDatabase() {
  console.log('Starting database seeding...');

  try {
    // Create a sample club
    const clubId = generateId();
    const userkey = 'CLUB_DEMO_001';

    await pool.query(`
      INSERT INTO clubs (id, userkey, name, district_id)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `, [clubId, userkey, 'Rotary Club Demo', 'D3000']);
    console.log('✓ Sample club created');

    // Get the club ID (in case it already existed)
    const [clubs] = await pool.query('SELECT id FROM clubs WHERE userkey = ?', [userkey]);
    const actualClubId = clubs[0].id;

    // Create sample members
    const members = [
      { name: 'Raghuraman N', email: 'raghuraman@example.com', phone: '9876543210' },
      { name: 'Sasikumar Chinnaswamy', email: 'sasikumar@example.com', phone: '9876543211' },
      { name: 'Mr Ramesh V R', email: 'ramesh@example.com', phone: '9876543212' },
      { name: 'Ganesh Khumar', email: 'ganesh@example.com', phone: '9876543213' },
      { name: 'T. ArulKumaran', email: 'arulkumaran@example.com', phone: '9876543214' },
      { name: 'Pradeep Gopal', email: 'pradeep@example.com', phone: '9876543215' },
      { name: 'Dr. Muthu Saravana Kumar', email: 'muthu@example.com', phone: '9876543216' },
      { name: 'Rajesh Kumar', email: 'rajesh@example.com', phone: '9876543217' },
      { name: 'Vikram Singh', email: 'vikram@example.com', phone: '9876543218' },
      { name: 'Sunita Agarwal', email: 'sunita@example.com', phone: '9876543219' },
      { name: 'Suresh Menon', email: 'suresh@example.com', phone: '9876543220' },
      { name: 'Arjun Patel', email: 'arjun@example.com', phone: '9876543221' },
      { name: 'Meera Joshi', email: 'meera@example.com', phone: '9876543222' },
      { name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543223' }
    ];

    const memberIds = [];
    for (const member of members) {
      const memberId = generateId();
      memberIds.push(memberId);
      await pool.query(`
        INSERT INTO members (id, club_id, external_member_id, name, email, phone, status, joined_date)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name)
      `, [memberId, actualClubId, `EXT_${memberId.slice(0, 8)}`, member.name, member.email, member.phone, '2024-01-01']);
    }
    console.log(`✓ ${members.length} sample members created`);

    // Get actual member IDs
    const [actualMembers] = await pool.query('SELECT id, name FROM members WHERE club_id = ?', [actualClubId]);

    // Get current rotary year
    const [rotaryYears] = await pool.query('SELECT id FROM rotary_years WHERE is_current = TRUE');
    const rotaryYearId = rotaryYears[0].id;

    // Create district dues config
    await pool.query(`
      INSERT INTO district_dues_config (id, club_id, rotary_year_id, amount, due_date)
      VALUES (?, ?, ?, 1000.00, '2025-07-31')
      ON DUPLICATE KEY UPDATE amount = VALUES(amount)
    `, [generateId(), actualClubId, rotaryYearId]);
    console.log('✓ District dues config created');

    // Create district dues payments for all members
    for (let i = 0; i < actualMembers.length; i++) {
      const member = actualMembers[i];
      const statuses = ['paid', 'pending', 'overdue'];
      const status = statuses[i % 3];
      const paidOn = status === 'paid' ? formatDateForDB(new Date(2025, 6, 10 + i)) : null;

      await pool.query(`
        INSERT INTO district_dues_payments (id, club_id, member_id, rotary_year_id, amount, due_date, status, paid_on)
        VALUES (?, ?, ?, ?, 1000.00, '2025-07-31', ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)
      `, [generateId(), actualClubId, member.id, rotaryYearId, status, paidOn]);
    }
    console.log('✓ District dues payments created');

    // Create sample subscriptions
    const subscriptions = [
      { name: 'Monthly Club Fee', description: 'Regular monthly membership fee for club activities', amount: 500, frequency: 'monthly', collection_day: 1 },
      { name: 'Annual Magazine Subscription', description: 'Yearly subscription for the Rotary magazine', amount: 1200, frequency: 'yearly', collection_day: 1 },
      { name: 'Sports Committee Fund', description: 'Quarterly contribution for sports events', amount: 750, frequency: 'quarterly', collection_day: 1 }
    ];

    const subscriptionIds = [];
    for (const sub of subscriptions) {
      const subId = generateId();
      subscriptionIds.push(subId);
      await pool.query(`
        INSERT INTO subscriptions (id, club_id, name, description, amount, frequency, collection_day, late_fee_enabled, late_fee_amount, late_fee_after_days, carry_forward_enabled, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, 50, 10, TRUE, 'active')
      `, [subId, actualClubId, sub.name, sub.description, sub.amount, sub.frequency, sub.collection_day]);
    }
    console.log('✓ Sample subscriptions created');

    // Add members to first subscription and create transactions
    const [subs] = await pool.query('SELECT id, amount, frequency FROM subscriptions WHERE club_id = ?', [actualClubId]);
    if (subs.length > 0) {
      const firstSub = subs[0];
      for (let i = 0; i < Math.min(8, actualMembers.length); i++) {
        const member = actualMembers[i];
        await pool.query(`
          INSERT INTO subscription_members (id, subscription_id, member_id, status)
          VALUES (?, ?, ?, 'active')
          ON DUPLICATE KEY UPDATE status = VALUES(status)
        `, [generateId(), firstSub.id, member.id]);

        const statuses = ['paid', 'pending', 'overdue'];
        const status = statuses[i % 3];
        const paidOn = status === 'paid' ? formatDateForDB(new Date(2025, 7, 10 + i)) : null;

        await pool.query(`
          INSERT INTO subscription_transactions (id, subscription_id, member_id, billing_period_start, billing_period_end, amount, late_fee, total_amount, due_date, status, paid_on)
          VALUES (?, ?, ?, '2025-08-01', '2025-08-31', ?, 0, ?, '2025-08-01', ?, ?)
          ON DUPLICATE KEY UPDATE status = VALUES(status)
        `, [generateId(), firstSub.id, member.id, firstSub.amount, firstSub.amount, status, paidOn]);
      }
      console.log('✓ Subscription members and transactions created');
    }

    // Create sample fundraisers
    const fundraisers = [
      {
        title: 'Clean Water Initiative',
        description: 'Help us provide clean drinking water to 5 villages in rural Tamil Nadu. Every contribution counts towards building sustainable water filtration systems.',
        target_amount: 500000,
        raised_amount: 342500,
        start_date: '2025-07-01',
        end_date: '2025-12-31'
      },
      {
        title: 'Education Scholarship Fund',
        description: 'Support underprivileged students with scholarships for higher education.',
        target_amount: 200000,
        raised_amount: 87000,
        start_date: '2025-07-01',
        end_date: '2026-02-15'
      }
    ];

    const fundraiserIds = [];
    for (const fr of fundraisers) {
      const frId = generateId();
      fundraiserIds.push(frId);
      await pool.query(`
        INSERT INTO fundraisers (id, club_id, title, description, target_amount, raised_amount, start_date, end_date, status, allow_anonymous, show_supporters_publicly)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', TRUE, TRUE)
      `, [frId, actualClubId, fr.title, fr.description, fr.target_amount, fr.raised_amount, fr.start_date, fr.end_date]);
    }
    console.log('✓ Sample fundraisers created');

    // Create sample donations for first fundraiser
    const [frs] = await pool.query('SELECT id FROM fundraisers WHERE club_id = ? LIMIT 1', [actualClubId]);
    if (frs.length > 0) {
      const donations = [
        { name: 'Rajesh Kumar', amount: 25000, is_anonymous: false },
        { name: 'Anonymous', amount: 10000, is_anonymous: true },
        { name: 'Vikram Singh', amount: 50000, is_anonymous: false },
        { name: 'Sunita Agarwal', amount: 15000, is_anonymous: false },
        { name: 'Suresh Menon', amount: 5000, is_anonymous: false },
        { name: 'Anonymous', amount: 2000, is_anonymous: true },
        { name: 'Arjun Patel', amount: 100000, is_anonymous: false },
        { name: 'Meera Joshi', amount: 7500, is_anonymous: false }
      ];

      for (let i = 0; i < donations.length; i++) {
        const donation = donations[i];
        const donatedAt = new Date(2025, 6, 5 + (i * 3));
        await pool.query(`
          INSERT INTO fundraiser_donations (id, fundraiser_id, donor_name, amount, is_anonymous, payment_mode, donated_at)
          VALUES (?, ?, ?, ?, ?, 'upi', ?)
        `, [generateId(), frs[0].id, donation.name, donation.amount, donation.is_anonymous, donatedAt]);
      }
      console.log('✓ Sample donations created');

      // Create social sharing stats
      const sharers = actualMembers.slice(0, 4);
      const sharingStats = [12, 8, 6, 5];
      for (let i = 0; i < sharers.length; i++) {
        await pool.query(`
          INSERT INTO fundraiser_shares (id, fundraiser_id, member_id, share_platform, donation_count, total_raised)
          VALUES (?, ?, ?, 'whatsapp', ?, ?)
        `, [generateId(), frs[0].id, sharers[i].id, sharingStats[i], sharingStats[i] * 5000]);
      }
      console.log('✓ Social sharing stats created');
    }

    console.log('\n✅ Database seeding completed successfully!');
    console.log(`\n📝 Use this userkey for testing: ${userkey}`);

  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    await pool.end();
  }
}

seedDatabase();
