import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { 
  initDb,
  getIncompleteUsersForReminder, 
  markRetargetingSent,
  getCompletedUsersForTrainingReminder,
  markTrainingReminderSent,
  getTodayCompletedUsersForMorningReminder,
  markMorningReminderSent
} from '../database.js';
import { getCityOffice, getUzbekDayName } from '../keyboards.js';

if (!config.botToken) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN is not configured!');
}

const bot = new Telegraf(config.botToken);

/**
 * Parses a YYYY-MM-DD date and HH:MM time into a Date object representing
 * the exact moment in Uzbekistan time (UTC+5).
 */
export function parseTrainingDatetime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  
  // Tashkent is UTC+5. To get the absolute UTC timestamp:
  // hour in UTC = hour - 5.
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute, 0, 0));
}

export default async function handler(req, res) {
  // 1. Authorize Cron trigger
  const authHeader = req.headers.authorization;
  if (config.cronSecret && authHeader !== `Bearer ${config.cronSecret}`) {
    console.warn('⚠️ Unauthorized cron trigger attempt rejected.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('⏰ Cron trigger started. Processing reminders...');

  try {
    // Ensure DB is initialized
    await initDb();
    const now = Date.now();
    const results = { 
      nudges: 0, 
      trainingReminders: 0, 
      morningReminders: 0, 
      skipped: 0, 
      errors: 0 
    };

    // 2. Process 30-Minute Retargeting Nudges
    const thirtyMinutesInSeconds = 30 * 60;
    const usersToNudge = await getIncompleteUsersForReminder(thirtyMinutesInSeconds);
    
    for (const user of usersToNudge) {
      try {
        await bot.telegram.sendMessage(
          user.user_id,
          `Ismingizni kiritish yodingizdan chiqdimi? 🤔\n\n` +
          `Uzum Tezkor kuryerlari jamoasida sizni intizorlik bilan kutyapmiz! Haftalik barqaror daromad, qulay ish grafigi va ajoyib jamoaga ega bo'lish uchun ro'yxatdan o'tishni yakunlang. 🚀\n\n` +
          `Buning uchun shunchaki /start buyrug'ini bosing va ma'lumotlaringizni to'ldiring.`
        );
        results.nudges++;
        console.log(`✉️ Nudge sent to user ${user.user_id}`);
      } catch (err) {
        results.errors++;
        console.error(`❌ Failed to send nudge to user ${user.user_id}:`, err.message);
      } finally {
        await markRetargetingSent(user.user_id);
      }
    }

    // 3. Process Morning 08:30 Reminders with Map Location & Interactive Buttons
    const tashkentOffsetMs = 5 * 60 * 60 * 1000;
    const tashkentNow = new Date(now + tashkentOffsetMs);
    const ty = tashkentNow.getUTCFullYear();
    const tm = String(tashkentNow.getUTCMonth() + 1).padStart(2, '0');
    const td = String(tashkentNow.getUTCDate()).padStart(2, '0');
    const todayStr = `${ty}-${tm}-${td}`;

    const todayUsers = await getTodayCompletedUsersForMorningReminder(todayStr);

    for (const user of todayUsers) {
      if (Number(user.user_id) <= 0) {
        await markMorningReminderSent(user.user_id);
        continue;
      }

      try {
        const trainingDate = parseTrainingDatetime(user.training_date, config.trainingTime);
        const trainingTimestamp = trainingDate.getTime();

        // If training time has already passed today by more than 2 hours, skip sending
        if (now > trainingTimestamp + (2 * 60 * 60 * 1000)) {
          results.skipped++;
          await markMorningReminderSent(user.user_id);
          continue;
        }

        const office = getCityOffice(user.city);

        // A. Send Map Location / Venue
        try {
          await bot.telegram.sendVenue(
            user.user_id,
            office.latitude,
            office.longitude,
            office.title,
            office.address
          );
        } catch (vErr) {
          try {
            await bot.telegram.sendLocation(user.user_id, office.latitude, office.longitude);
          } catch (lErr) {
            console.warn(`⚠️ Could not send location to user ${user.user_id}:`, lErr.message);
          }
        }

        // B. Send interactive confirmation message
        const morningMessage = 
          `🔔 *Bugun sizning treningingiz kuni!* 🚀\n\n` +
          `Assalomu alaykum, *${user.full_name || 'kuryer'}*!\n\n` +
          `Bugun sizni Uzum Tezkor kuryerlar inkubatorida kutib qolamiz:\n` +
          `⏰ *Boshlanish vaqti:* Soat *${config.trainingTime}* da\n` +
          `📍 *Manzil:* ${office.address}\n` +
          `🚗 *Tanlangan transport:* ${user.transport_type || 'Kuryer'}\n\n` +
          `🗺 *Ofis lokatsiyasi xaritada yuqorida yuborildi.*\n\n` +
          `Iltimos, bugun treningga kelishingizni tasdiqlang:`;

        await bot.telegram.sendMessage(user.user_id, morningMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Ha, albatta boraman", callback_data: `att_confirm_${user.user_id}` }
              ],
              [
                { text: "❌ Bora olmayman (Kechiktirish)", callback_data: `att_resched_${user.user_id}` }
              ]
            ]
          }
        });

        results.morningReminders++;
        console.log(`✉️ Morning 08:30 reminder + map sent to user ${user.user_id}`);
      } catch (err) {
        results.errors++;
        console.error(`❌ Failed to send morning reminder to user ${user.user_id}:`, err.message);
      } finally {
        await markMorningReminderSent(user.user_id);
      }
    }

    // 4. Process 1-Day Before (12-24h) Training Reminders
    const completedUsers = await getCompletedUsersForTrainingReminder();
    
    for (const user of completedUsers) {
      if (Number(user.user_id) <= 0) {
        await markTrainingReminderSent(user.user_id);
        continue;
      }
      try {
        const trainingDate = parseTrainingDatetime(user.training_date, config.trainingTime);
        const trainingTimestamp = trainingDate.getTime();
        const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
        const reminderStartTimestamp = trainingTimestamp - twentyFourHoursInMs;
        
        if (now >= reminderStartTimestamp && now < trainingTimestamp) {
          const formattedDate = getUzbekDayName(user.training_date);
          const office = getCityOffice(user.city);
          
          await bot.telegram.sendMessage(
            user.user_id,
            `Eslatma! Ertaga sizning treningingiz kuni! 📅\n\n` +
            `Siz tanlagan trening kuni va vaqti:\n` +
            `🗓 *${formattedDate}* soat *${config.trainingTime}* da.\n` +
            `📍 *Manzil:* ${office.address}\n\n` +
            `Ertaga ertalab soat 08:30 da sizga aniq geolokatsiya va yo'nalish yuboriladi. Treningga kelishingizni tasdiqlaysizmi?`,
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Ha, albatta boraman", callback_data: `att_confirm_${user.user_id}` }
                  ],
                  [
                    { text: "❌ Bora olmayman (Kechiktirish)", callback_data: `att_resched_${user.user_id}` }
                  ]
                ]
              }
            }
          );
          
          results.trainingReminders++;
          console.log(`✉️ 1-day before training reminder sent to user ${user.user_id}`);
          await markTrainingReminderSent(user.user_id);
        } else if (now >= trainingTimestamp) {
          results.skipped++;
          console.log(`ℹ️ Training time passed for user ${user.user_id}. Marking sent.`);
          await markTrainingReminderSent(user.user_id);
        }
      } catch (err) {
        results.errors++;
        console.error(`❌ Failed to process training reminder for user ${user.user_id}:`, err.message);
        await markTrainingReminderSent(user.user_id);
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (error) {
    console.error('❌ Cron job execution error:', error);
    return res.status(500).json({ error: error.message });
  }
}
