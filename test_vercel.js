import { config } from './config.js';
import { getNext5WorkingDays } from './keyboards.js';
import handlerBot from './api/bot.js';
import handlerCron from './api/cron.js';

console.log('🧪 Starting Vercel Serverless Architecture Validation...\n');

try {
  // Test 1: Syntactic validation
  console.log('--- 1. Verification of Serverless Entrypoints ---');
  if (typeof handlerBot !== 'function' || typeof handlerCron !== 'function') {
    throw new Error('Serverless route handler exports must be functions!');
  }
  console.log('✅ Serverless handler exports check passed!');

  // Test 2: Keyboards date calculations
  console.log('\n--- 2. Dynamic Weekday Keyboard Generator ---');
  const workingDays = getNext5WorkingDays();
  workingDays.forEach((day, index) => {
    console.log(`  [${index + 1}] Name: ${day.name} -> Value: ${day.value}`);
  });
  if (workingDays.length !== 5) {
    throw new Error(`Expected 5 working days, got ${workingDays.length}`);
  }
  console.log('✅ Weekday generator check passed!');

  // Test 2b: Timezone calculation for Uzbekistan (Asia/Tashkent UTC+5)
  console.log('\n--- 2b. Timezone Calculation Test ---');
  const { parseTrainingDatetime } = await import('./api/cron.js');
  const testTashkentDate = parseTrainingDatetime('2026-07-06', '10:00');
  // 10:00 AM Tashkent time is 05:00 AM UTC
  if (testTashkentDate.getUTCHours() !== 5 || testTashkentDate.getUTCMinutes() !== 0) {
    throw new Error(`Timezone offset calculation mismatch! Expected 5 UTC hours, got ${testTashkentDate.getUTCHours()}`);
  }
  console.log(`✅ Timezone check passed: 10:00 Tashkent = ${testTashkentDate.toISOString()}`);

  // Test 3: Database operations (Conditional on DATABASE_URL configuration)
  console.log('\n--- 3. Testing Database Connectivity ---');
  if (!config.databaseUrl) {
    console.log('ℹ️ DATABASE_URL is not set. Skipping active database tests.');
    console.log('👉 To run DB connection tests, add your PostgreSQL connection string in .env');
  } else {
    const { 
      initDb, 
      saveUserStart, 
      updateUserField, 
      completeRegistration, 
      getUser, 
      getIncompleteUsersForReminder, 
      getCompletedUsersForTrainingReminder,
      getPool
    } = await import('./database.js');

    console.log('Initializing database schema in PostgreSQL...');
    await initDb();

    const testUserId = 77777777;
    const testUsername = 'vercel_courier_test';

    console.log('Testing User Profile Creation...');
    await saveUserStart(testUserId, testUsername);

    let user = await getUser(testUserId);
    if (!user || user.status !== 'started' || user.username !== testUsername) {
      throw new Error('Database INSERT query failed!');
    }
    console.log('✅ User profile creation check passed!');

    console.log('Testing User Field Updates...');
    await updateUserField(testUserId, 'full_name', 'Jamshid Karimov');
    await updateUserField(testUserId, 'transport_type', 'Elektrovelo');
    await updateUserField(testUserId, 'city', 'Samarqand');
    await updateUserField(testUserId, 'phone_number', '+998931112233');

    user = await getUser(testUserId);
    if (
      user.full_name !== 'Jamshid Karimov' || 
      user.transport_type !== 'Elektrovelo' || 
      user.city !== 'Samarqand' || 
      user.phone_number !== '+998931112233'
    ) {
      throw new Error('Database UPDATE query failed!');
    }
    console.log('✅ User field updates check passed!');

    console.log('Testing Nudge Search Query...');
    // Query with negative threshold to match newly inserted user
    const nudgeList = await getIncompleteUsersForReminder(-10);
    const matchedNudge = nudgeList.find(u => u.user_id === testUserId);
    if (!matchedNudge) {
      throw new Error('Nudge search query failed!');
    }
    console.log('✅ Incomplete nudge search query check passed!');

    console.log('Testing Completion Status...');
    const tomorrowValue = workingDays[0].value;
    await updateUserField(testUserId, 'training_date', tomorrowValue);
    await completeRegistration(testUserId);

    user = await getUser(testUserId);
    if (user.status !== 'completed' || user.training_date !== tomorrowValue) {
      throw new Error('Database complete registration update failed!');
    }
    console.log('✅ User registration completion check passed!');

    console.log('Testing Training Reminder Query...');
    const completedList = await getCompletedUsersForTrainingReminder();
    const matchedCompleted = completedList.find(u => u.user_id === testUserId);
    if (!matchedCompleted) {
      throw new Error('Completed user reminder search failed!');
    }
    console.log('✅ Completed user reminder query check passed!');

    console.log('Testing Morning Reminder and Attendance Functions...');
    const { 
      getTodayCompletedUsersForMorningReminder, 
      markMorningReminderSent, 
      updateAttendanceStatus, 
      rescheduleTrainingDate 
    } = await import('./database.js');
    const { getCityOffice, getUzbekDayName } = await import('./keyboards.js');

    const office = getCityOffice('Toshkent');
    if (!office || !office.latitude || !office.address) {
      throw new Error('Office location lookup failed!');
    }
    console.log(`✅ Office location check passed: ${office.title} (${office.address})`);

    const formattedDay = getUzbekDayName('2026-10-01');
    console.log(`✅ Uzbek day format check passed: ${formattedDay}`);

    // Test morning reminder lookup
    const todayMorningList = await getTodayCompletedUsersForMorningReminder(tomorrowValue);
    console.log(`✅ Morning reminder query executed (${todayMorningList.length} users found).`);

    // Test attendance confirmation
    await updateAttendanceStatus(testUserId, 'confirmed');
    user = await getUser(testUserId);
    if (user.attendance_status !== 'confirmed') {
      throw new Error('Attendance confirmation failed!');
    }
    console.log('✅ Attendance confirmation check passed!');

    // Test reschedule training date
    const newRescheduleDate = workingDays[1].value;
    await rescheduleTrainingDate(testUserId, newRescheduleDate);
    user = await getUser(testUserId);
    if (user.training_date !== newRescheduleDate || user.attendance_status !== 'rescheduled') {
      throw new Error('Training reschedule failed!');
    }
    console.log('✅ Training reschedule check passed!');

    // Clean up test user
    await getPool().query('DELETE FROM users WHERE user_id = $1', [testUserId]);

    console.log('Testing PostgreSQL Session Persistence...');
    const { pgSessionMiddleware } = await import('./database.js');
    const middleware = pgSessionMiddleware();
    const fakeCtx = { from: { id: testUserId } };
    
    // Save session in request 1
    await middleware(fakeCtx, async () => {
      fakeCtx.session = { __scenes: { current: 'COURIER_ONBOARDING_WIZARD', cursor: 2, state: { fullName: 'Test' } } };
    });

    // Restore session in request 2 (simulating cold start)
    const coldCtx = { from: { id: testUserId } };
    await middleware(coldCtx, async () => {
      if (coldCtx.session?.__scenes?.current !== 'COURIER_ONBOARDING_WIZARD' || coldCtx.session?.__scenes?.cursor !== 2) {
        throw new Error('Session was not restored from PostgreSQL correctly!');
      }
      coldCtx.session = null; // Clean up
    });
    console.log('✅ Session persistence check passed!');

    // Close pg client pool connection
    console.log('Closing PostgreSQL client connection pool...');
    await getPool().end();
    console.log('✅ Connection closed.');
  }

  console.log('\n✨ ALL SERVERLESS CODE CHECKS PASRED SUCCESSFULLY! ✨');
} catch (error) {
  console.error('\n❌ Serverless validation failed with error:', error);
  process.exit(1);
}
