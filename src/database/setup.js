const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.example') });

async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  console.log('Connected to MySQL server');

  // Create database
  await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'FQxRT'}`);
  await connection.query(`USE ${process.env.DB_NAME || 'FQxRT'}`);
  console.log('Database FQxRT created/selected');

  // Create tables
  const schema = `
    -- Clubs table (for multi-tenancy)
    CREATE TABLE IF NOT EXISTS clubs (
      id VARCHAR(36) PRIMARY KEY,
      userkey VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      district_id VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_userkey (userkey)
    );

    -- Members table (replicated from external system)
    -- Note: club_id references manchesterclub.clubdetails.clubno (userkey), not local clubs table
    CREATE TABLE IF NOT EXISTS members (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      external_member_id VARCHAR(100),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(20),
      status ENUM('active', 'inactive') DEFAULT 'active',
      joined_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_club_id (club_id),
      INDEX idx_external_id (external_member_id),
      INDEX idx_status (status)
    );

    -- Rotary Years (July 1 - June 30)
    CREATE TABLE IF NOT EXISTS rotary_years (
      id VARCHAR(36) PRIMARY KEY,
      year_label VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_current BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_year_label (year_label),
      INDEX idx_current (is_current)
    );

    -- District Dues Configuration
    -- Note: club_id references manchesterclub.clubdetails.clubno (userkey)
    CREATE TABLE IF NOT EXISTS district_dues_config (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      rotary_year_id VARCHAR(36) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL DEFAULT 1000.00,
      due_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (rotary_year_id) REFERENCES rotary_years(id) ON DELETE CASCADE,
      UNIQUE KEY uk_club_year (club_id, rotary_year_id),
      INDEX idx_club_id (club_id)
    );

    -- District Dues Payments
    -- Note: club_id references manchesterclub.clubdetails.clubno (userkey)
    CREATE TABLE IF NOT EXISTS district_dues_payments (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      member_id VARCHAR(36) NOT NULL,
      rotary_year_id VARCHAR(36) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      due_date DATE NOT NULL,
      status ENUM('pending', 'paid', 'overdue') DEFAULT 'pending',
      paid_on DATE,
      payment_mode VARCHAR(50),
      reference_id VARCHAR(100),
      notes TEXT,
      reminder_sent_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (rotary_year_id) REFERENCES rotary_years(id) ON DELETE CASCADE,
      UNIQUE KEY uk_member_year (member_id, rotary_year_id),
      INDEX idx_club_id (club_id),
      INDEX idx_status (status),
      INDEX idx_due_date (due_date)
    );

    -- Subscriptions
    -- Note: club_id references manchesterclub.clubdetails.clubno (userkey)
    CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      amount DECIMAL(10, 2) NOT NULL,
      frequency ENUM('monthly', 'quarterly', 'yearly') NOT NULL,
      collection_day INT NOT NULL,
      late_fee_enabled BOOLEAN DEFAULT FALSE,
      late_fee_amount DECIMAL(10, 2) DEFAULT 0,
      late_fee_after_days INT DEFAULT 10,
      carry_forward_enabled BOOLEAN DEFAULT FALSE,
      status ENUM('active', 'inactive') DEFAULT 'active',
      deactivation_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_club_id (club_id),
      INDEX idx_status (status)
    );

    -- Subscription Members (which members are part of which subscription)
    CREATE TABLE IF NOT EXISTS subscription_members (
      id VARCHAR(36) PRIMARY KEY,
      subscription_id VARCHAR(36) NOT NULL,
      member_id VARCHAR(36) NOT NULL,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status ENUM('active', 'inactive') DEFAULT 'active',
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE KEY uk_sub_member (subscription_id, member_id),
      INDEX idx_subscription_id (subscription_id),
      INDEX idx_member_id (member_id)
    );

    -- Subscription Transactions (payment records for each billing cycle)
    CREATE TABLE IF NOT EXISTS subscription_transactions (
      id VARCHAR(36) PRIMARY KEY,
      subscription_id VARCHAR(36) NOT NULL,
      member_id VARCHAR(36) NOT NULL,
      billing_period_start DATE NOT NULL,
      billing_period_end DATE NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      late_fee DECIMAL(10, 2) DEFAULT 0,
      total_amount DECIMAL(10, 2) NOT NULL,
      due_date DATE NOT NULL,
      status ENUM('pending', 'paid', 'overdue') DEFAULT 'pending',
      paid_on DATE,
      payment_mode VARCHAR(50),
      reference_id VARCHAR(100),
      notes TEXT,
      reminder_sent_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      INDEX idx_subscription_id (subscription_id),
      INDEX idx_member_id (member_id),
      INDEX idx_status (status),
      INDEX idx_due_date (due_date),
      UNIQUE KEY uk_sub_member_period (subscription_id, member_id, billing_period_start)
    );

    -- Fundraisers
    -- Note: club_id references manchesterclub.clubdetails.clubno (userkey)
    CREATE TABLE IF NOT EXISTS fundraisers (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      cover_photo_url VARCHAR(500),
      target_amount DECIMAL(12, 2) NOT NULL,
      raised_amount DECIMAL(12, 2) DEFAULT 0,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status ENUM('draft', 'active', 'completed', 'cancelled') DEFAULT 'active',
      allow_anonymous BOOLEAN DEFAULT TRUE,
      show_supporters_publicly BOOLEAN DEFAULT TRUE,
      thank_you_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_club_id (club_id),
      INDEX idx_status (status),
      INDEX idx_dates (start_date, end_date)
    );

    -- Fundraiser Donations
    CREATE TABLE IF NOT EXISTS fundraiser_donations (
      id VARCHAR(36) PRIMARY KEY,
      fundraiser_id VARCHAR(36) NOT NULL,
      donor_name VARCHAR(255),
      donor_email VARCHAR(255),
      donor_phone VARCHAR(20),
      member_id VARCHAR(36),
      amount DECIMAL(12, 2) NOT NULL,
      is_anonymous BOOLEAN DEFAULT FALSE,
      payment_mode VARCHAR(50),
      reference_id VARCHAR(100),
      notes TEXT,
      referred_by_member_id VARCHAR(36),
      donated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fundraiser_id) REFERENCES fundraisers(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (referred_by_member_id) REFERENCES members(id) ON DELETE SET NULL,
      INDEX idx_fundraiser_id (fundraiser_id),
      INDEX idx_member_id (member_id),
      INDEX idx_referred_by (referred_by_member_id),
      INDEX idx_donated_at (donated_at)
    );

    -- Social Sharing Tracking (for leaderboard)
    CREATE TABLE IF NOT EXISTS fundraiser_shares (
      id VARCHAR(36) PRIMARY KEY,
      fundraiser_id VARCHAR(36) NOT NULL,
      member_id VARCHAR(36) NOT NULL,
      share_platform VARCHAR(50),
      share_link VARCHAR(500),
      click_count INT DEFAULT 0,
      donation_count INT DEFAULT 0,
      total_raised DECIMAL(12, 2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (fundraiser_id) REFERENCES fundraisers(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      INDEX idx_fundraiser_id (fundraiser_id),
      INDEX idx_member_id (member_id)
    );

    -- Payment Reminders Log
    -- Note: club_id references manchesterclub.clubdetails.clubno (userkey)
    CREATE TABLE IF NOT EXISTS reminder_logs (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      reminder_type ENUM('district_dues', 'subscription') NOT NULL,
      reference_id VARCHAR(36) NOT NULL,
      member_id VARCHAR(36) NOT NULL,
      sent_via ENUM('email', 'sms', 'whatsapp', 'push') NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status ENUM('sent', 'delivered', 'failed') DEFAULT 'sent',
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      INDEX idx_club_id (club_id),
      INDEX idx_reference_id (reference_id),
      INDEX idx_sent_at (sent_at)
    );
  `;

  await connection.query(schema);
  console.log('All tables created successfully');

  // Insert default Rotary Years
  const rotaryYears = `
    INSERT IGNORE INTO rotary_years (id, year_label, start_date, end_date, is_current) VALUES
    (UUID(), '2024-25', '2024-07-01', '2025-06-30', FALSE),
    (UUID(), '2025-26', '2025-07-01', '2026-06-30', TRUE),
    (UUID(), '2026-27', '2026-07-01', '2027-06-30', FALSE);
  `;
  await connection.query(rotaryYears);
  console.log('Default Rotary Years inserted');

  await connection.end();
  console.log('Database setup completed successfully!');
}

setupDatabase().catch(err => {
  console.error('Database setup failed:', err);
  process.exit(1);
});
