const { v4: uuidv4 } = require('uuid');
const { format, addMonths, addQuarters, addYears, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, isAfter, parseISO } = require('date-fns');

// Generate UUID
const generateId = () => uuidv4();

// Get current Rotary Year (July 1 - June 30)
const getCurrentRotaryYear = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  if (currentMonth >= 7) {
    return `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
  } else {
    return `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
  }
};

// Calculate due date status
const calculateStatus = (dueDate, paidOn) => {
  if (paidOn) return 'paid';
  const today = new Date();
  const due = new Date(dueDate);
  return isAfter(today, due) ? 'overdue' : 'pending';
};

// Calculate billing period based on frequency
const calculateBillingPeriod = (frequency, referenceDate = new Date()) => {
  const date = typeof referenceDate === 'string' ? parseISO(referenceDate) : referenceDate;
  
  switch (frequency) {
    case 'monthly':
      return {
        start: startOfMonth(date),
        end: endOfMonth(date)
      };
    case 'quarterly':
      return {
        start: startOfQuarter(date),
        end: endOfQuarter(date)
      };
    case 'yearly':
      return {
        start: startOfYear(date),
        end: endOfYear(date)
      };
    default:
      return {
        start: startOfMonth(date),
        end: endOfMonth(date)
      };
  }
};

// Calculate next billing date
const getNextBillingDate = (frequency, currentDate = new Date()) => {
  switch (frequency) {
    case 'monthly':
      return addMonths(currentDate, 1);
    case 'quarterly':
      return addQuarters(currentDate, 1);
    case 'yearly':
      return addYears(currentDate, 1);
    default:
      return addMonths(currentDate, 1);
  }
};

// Format date for MySQL
const formatDateForDB = (date) => {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'yyyy-MM-dd');
};

// Standard API response
const apiResponse = (res, success, data = null, message = '', statusCode = 200) => {
  return res.status(statusCode).json({
    success,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

// Error response
const errorResponse = (res, message, statusCode = 500, error = null) => {
  console.error(message, error);
  return res.status(statusCode).json({
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? error?.message : undefined,
    timestamp: new Date().toISOString()
  });
};

// Validate required fields
const validateRequired = (body, requiredFields) => {
  const missing = requiredFields.filter(field => !body[field]);
  if (missing.length > 0) {
    return { valid: false, missing };
  }
  return { valid: true };
};

module.exports = {
  generateId,
  getCurrentRotaryYear,
  calculateStatus,
  calculateBillingPeriod,
  getNextBillingDate,
  formatDateForDB,
  apiResponse,
  errorResponse,
  validateRequired
};
