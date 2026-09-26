import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { 
  initDb,
  getIncompleteUsersForReminder, 
  markRetargetingSent,
  getCompletedUsersForTrainingReminder,
  markTrainingReminderSent
} from '../database.js';

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
    const results = { nudges: 0, trainingReminders: 0, skipped: 0, errors: 0 };

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

    // 3. Process 12-Hour Training Reminders
    const completedUsers = await getCompletedUsersForTrainingReminder();
    
    for (const user of completedUsers) {
      if (Number(user.user_id) <= 0) {
        await markTrainingReminderSent(user.user_id);
        continue;
      }
      try {
        const trainingDate = parseTrainingDatetime(user.training_date, config.trainingTime);
        const trainingTimestamp = trainingDate.getTime();
        const twelveHoursInMs = 12 * 60 * 60 * 1000;
        const reminderStartTimestamp = trainingTimestamp - twelveHoursInMs;
        
        if (now >= reminderStartTimestamp && now < trainingTimestamp) {
          const [year, month, day] = user.training_date.split('-');
          const formattedDate = `${day}.${month}.${year}`;
          
          await bot.telegram.sendMessage(
            user.user_id,
            `Eslatma! Treningingiz boshlanishiga oz fursat qoldi! 📅\n\n` +
            `Siz tanlagan trening kuni va vaqti:\n` +
            `🗓 *${formattedDate}* soat *${config.trainingTime}* da.\n\n` +
            `Sizni Uzum Tezkor ofisida kutamiz! Kechikmasdan kelishingizni so'raymiz. Savollar yuzasidan operatorlarimiz bog'lanishini kuting. 🚀`,
            { parse_mode: 'Markdown' }
          );
          
          results.trainingReminders++;
          console.log(`✉️ Training reminder sent to user ${user.user_id}`);
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
