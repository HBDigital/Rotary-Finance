const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.example') });

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'FQxRT'
  });

  console.log('Connected to database');

  // Drop old tables
  await conn.query('DROP TABLE IF EXISTS district_dues_payments');
  console.log('Dropped district_dues_payments');
  
  await conn.query('DROP TABLE IF EXISTS district_dues_config');
  console.log('Dropped old district_dues_config');

  // Create new district_dues_config table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS district_dues_config (
      id VARCHAR(36) PRIMARY KEY,
      rotary_year VARCHAR(20) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL DEFAULT 1000.00,
      transaction_fee_percent DECIMAL(5, 2) NOT NULL DEFAULT 2.50,
      due_date DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_rotary_year (rotary_year)
    )
  `);
  console.log('Created district_dues_config table');

  // Create new district_dues_club_payments table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS district_dues_club_payments (
      id VARCHAR(36) PRIMARY KEY,
      club_id VARCHAR(50) NOT NULL,
      rotary_year VARCHAR(20) NOT NULL,
      member_count INT NOT NULL,
      amount_per_member DECIMAL(10, 2) NOT NULL,
      total_amount DECIMAL(10, 2) NOT NULL,
      transaction_fee_percent DECIMAL(5, 2) NOT NULL,
      transaction_fee DECIMAL(10, 2) NOT NULL,
      grand_total DECIMAL(10, 2) NOT NULL,
      status ENUM('pending', 'paid') DEFAULT 'pending',
      paid_on DATE,
      payment_mode VARCHAR(50),
      reference_id VARCHAR(100),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_club_year (club_id, rotary_year),
      INDEX idx_club_id (club_id),
      INDEX idx_status (status),
      INDEX idx_rotary_year (rotary_year)
    )
  `);
  console.log('Created district_dues_club_payments table');

  console.log('\n✅ Migration completed successfully!');
  await conn.end();
}

migrate().catch(console.error);
