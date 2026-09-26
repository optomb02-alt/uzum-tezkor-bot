import pkg from 'pg';
const { Pool, types } = pkg;
import { config } from './config.js';

// Parse PostgreSQL BIGINT (type OID 20) as safe JS integers
types.setTypeParser(20, (val) => parseInt(val, 10));

let poolInstance = null;

export function getPool() {
  if (!poolInstance) {
    if (!config.databaseUrl) {
      throw new Error('❌ DATABASE_URL environment variable is missing!');
    }
    
    // Automatically enable SSL rejection bypass for Supabase and Neon
    const isCloudPg = config.databaseUrl.includes('supabase') || config.databaseUrl.includes('neon');
    
    poolInstance = new Pool({
      connectionString: config.databaseUrl,
      ssl: isCloudPg ? { rejectUnauthorized: false } : false
    });
  }
  return poolInstance;
}

/**
 * Initializes the database schema in PostgreSQL
 */
export async function initDb() {
  const pool = getPool();
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      username TEXT,
      full_name TEXT,
      transport_type TEXT,
      city TEXT,
      phone_number TEXT,
      training_date TEXT,
      status TEXT DEFAULT 'started',
      created_at BIGINT,
      updated_at BIGINT,
      last_reminder_sent BIGINT DEFAULT NULL,
      training_reminder_sent BIGINT DEFAULT NULL,
      morning_reminder_sent BIGINT DEFAULT NULL,
      attendance_status TEXT DEFAULT NULL
    )
  `);

  // Safe migration for existing installations
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS morning_reminder_sent BIGINT DEFAULT NULL;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_status TEXT DEFAULT NULL;`);
  } catch (migErr) {
    console.warn('⚠️ Column migration notice:', migErr.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegraf_sessions (
      key TEXT PRIMARY KEY,
      session TEXT,
      updated_at BIGINT
    )
  `);
  
  console.log('💾 PostgreSQL database initialized.');
}

/**
 * Creates or resets a user registration profile on /start
 */
export async function saveUserStart(userId, username) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  
  const query = `
    INSERT INTO users (
      user_id, username, status, created_at, updated_at, 
      full_name, transport_type, city, phone_number, training_date, 
      last_reminder_sent, training_reminder_sent
    )
    VALUES ($1, $2, 'started', $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      status = 'started',
      updated_at = EXCLUDED.updated_at,
      full_name = NULL,
      transport_type = NULL,
      city = NULL,
      phone_number = NULL,
      training_date = NULL,
      last_reminder_sent = NULL,
      training_reminder_sent = NULL
  `;
  
  await pool.query(query, [userId, username || null, now, now]);
}

/**
 * Updates a specific onboarding data point for the user
 */
export async function updateUserField(userId, field, value) {
  const pool = getPool();
  const allowedFields = ['full_name', 'transport_type', 'city', 'phone_number', 'training_date'];
  
  if (!allowedFields.includes(field)) {
    throw new Error(`Invalid field update attempted: ${field}`);
  }
  
  const now = Math.floor(Date.now() / 1000);
  const query = `
    UPDATE users 
    SET ${field} = $1, status = 'incomplete', updated_at = $2 
    WHERE user_id = $3
  `;
  
  await pool.query(query, [value, now, userId]);
}

/**
 * Marks a user's registration status as 'completed'
 */
export async function completeRegistration(userId) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  
  await pool.query(`
    UPDATE users 
    SET status = 'completed', updated_at = $1 
    WHERE user_id = $2
  `, [now, userId]);
}

/**
 * Fetches user profile from database
 */
export async function getUser(userId) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

/**
 * Fetches users who haven't completed registration for over a certain duration
 * and have not yet received the retargeting reminder.
 * Only targets real Telegram users (positive user_id).
 */
export async function getIncompleteUsersForReminder(thresholdSeconds) {
  const pool = getPool();
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  
  const res = await pool.query(`
    SELECT * FROM users 
    WHERE status != 'completed' 
      AND user_id > 0 
      AND (username IS NULL OR username != 'web_form')
      AND updated_at < $1 
      AND last_reminder_sent IS NULL
  `, [cutoff]);
  
  return res.rows;
}

/**
 * Marks retargeting reminder as sent to avoid duplicates
 */
export async function markRetargetingSent(userId) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  await pool.query('UPDATE users SET last_reminder_sent = $1 WHERE user_id = $2', [now, userId]);
}

/**
 * Fetches all completed registrations that haven't received training reminders
 * Only targets real Telegram users (positive user_id).
 */
export async function getCompletedUsersForTrainingReminder() {
  const pool = getPool();
  const res = await pool.query(`
    SELECT * FROM users 
    WHERE status = 'completed' 
      AND user_id > 0
      AND (username IS NULL OR username != 'web_form')
      AND training_date IS NOT NULL 
      AND training_reminder_sent IS NULL
  `);
  return res.rows;
}

/**
 * Marks 12-hour training reminder as sent
 */
export async function markTrainingReminderSent(userId) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  await pool.query('UPDATE users SET training_reminder_sent = $1 WHERE user_id = $2', [now, userId]);
}

/**
 * Fetches completed registrations whose training is scheduled for today
 * and haven't received the 08:30 morning reminder yet.
 */
export async function getTodayCompletedUsersForMorningReminder(todayStr) {
  const pool = getPool();
  const res = await pool.query(`
    SELECT * FROM users 
    WHERE status = 'completed' 
      AND user_id > 0
      AND (username IS NULL OR username != 'web_form')
      AND training_date = $1 
      AND morning_reminder_sent IS NULL
  `, [todayStr]);
  return res.rows;
}

/**
 * Marks morning 08:30 reminder as sent
 */
export async function markMorningReminderSent(userId) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  await pool.query('UPDATE users SET morning_reminder_sent = $1 WHERE user_id = $2', [now, userId]);
}

/**
 * Updates attendance confirmation status ('confirmed' or 'declined')
 */
export async function updateAttendanceStatus(userId, status) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  await pool.query('UPDATE users SET attendance_status = $1, updated_at = $2 WHERE user_id = $3', [status, now, userId]);
}

/**
 * Reschedules a user's training date to a new date and resets reminders
 */
export async function rescheduleTrainingDate(userId, newDate) {
  const pool = getPool();
  const now = Math.floor(Date.now() / 1000);
  await pool.query(`
    UPDATE users 
    SET training_date = $1, 
        training_reminder_sent = NULL, 
        morning_reminder_sent = NULL, 
        attendance_status = 'rescheduled', 
        updated_at = $2 
    WHERE user_id = $3
  `, [newDate, now, userId]);
}

/**
 * PostgreSQL-backed session middleware for Telegraf.
 * Ensures scene and wizard states persist across Vercel serverless cold starts.
 */
export function pgSessionMiddleware() {
  return async (ctx, next) => {
    const key = ctx.from?.id ? String(ctx.from.id) : null;
    if (!key) {
      return next();
    }

    const pool = getPool();
    let sessionData = {};

    try {
      const res = await pool.query('SELECT session FROM telegraf_sessions WHERE key = $1', [key]);
      if (res.rows.length > 0 && res.rows[0].session) {
        sessionData = JSON.parse(res.rows[0].session);
      }
    } catch (err) {
      console.error(`⚠️ Failed to load session for ${key}:`, err.message);
    }

    ctx.session = sessionData;

    await next();

    try {
      if (!ctx.session || Object.keys(ctx.session).length === 0) {
        await pool.query('DELETE FROM telegraf_sessions WHERE key = $1', [key]);
      } else {
        const now = Math.floor(Date.now() / 1000);
        await pool.query(`
          INSERT INTO telegraf_sessions (key, session, updated_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (key) DO UPDATE SET
            session = EXCLUDED.session,
            updated_at = EXCLUDED.updated_at
        `, [key, JSON.stringify(ctx.session), now]);
      }
    } catch (err) {
      console.error(`⚠️ Failed to save session for ${key}:`, err.message);
    }
  };
}

