import { Telegraf, Scenes } from 'telegraf';
import { config } from '../config.js';
import { 
  initDb, 
  saveUserStart, 
  pgSessionMiddleware,
  getUser,
  updateAttendanceStatus,
  rescheduleTrainingDate
} from '../database.js';
import { onboardingWizard, COURIER_ONBOARDING_WIZARD } from '../scenes.js';
import { getNext5WorkingDays, getUzbekDayName } from '../keyboards.js';

// Pre-initialize database on cold start
let dbPromise = null;
function getDbInit() {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

if (!config.botToken) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN is not configured!');
}

const bot = new Telegraf(config.botToken);

// Create Stage FSM
const stage = new Scenes.Stage([onboardingWizard]);

// Persistent PostgreSQL session middleware for reliable serverless execution
bot.use(pgSessionMiddleware());
bot.use(stage.middleware());

const WEB_APP_URL = 'https://uzum-tezkor-bot.vercel.app';

// Handle /start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || '';
  
  console.log(`🤖 User ${userId} (${username}) triggered /start`);
  
  // Save or reset the user profile in the database
  await saveUserStart(userId, username);
  
  await ctx.reply(
    `Assalomu alaykum! "Uzum Tezkor" kuryerlari jamoasiga xush kelibsiz! 🚀\n\n` +
    `Biz bilan hamkorlik qilib:\n` +
    `• ⏰ Qulay va erkin ish grafigi\n` +
    `• 💵 Barqaror haftalik daromad\n` +
    `• ⚡ Yuqori bonuslar va ajoyib jamoaga ega bo'lasiz!\n\n` +
    `Ro'yxatdan o'tish uchun pastdagi *«🚀 Ro'yxatdan o'tish»* tugmasini bosing:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Ro'yxatdan o'tish (Mini App)",
              web_app: { url: WEB_APP_URL }
            }
          ],
          [
            {
              text: "💬 Bot orqali to'ldirish",
              callback_data: 'start_chat_wizard'
            }
          ]
        ]
      }
    }
  );
});

// Fallback action if user chooses to register via chat conversation
bot.action('start_chat_wizard', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  return ctx.scene.enter(COURIER_ONBOARDING_WIZARD);
});

// Handle attendance confirmation ("Ha, albatta boraman")
bot.action(/^att_confirm_(\d+)$/, async (ctx) => {
  const targetUserId = ctx.match[1];
  if (String(ctx.from.id) !== targetUserId) {
    return ctx.answerCbQuery('Bu tugma faqat ariza egasi uchun!', { show_alert: true });
  }

  await ctx.answerCbQuery('Ishtirokingiz tasdiqlandi! Rahmat!').catch(() => {});
  await updateAttendanceStatus(ctx.from.id, 'confirmed');

  await ctx.editMessageText(
    `✅ *Ishtirokingiz tasdiqlandi!* Rahmat.\n\n` +
    `Sizni belgilangan vaqtda Uzum Tezkor trening markazida kutib qolamiz! 🚀\n` +
    `📍 Ofis manzili va geolokatsiyasi yuqoridagi xaritada ko'rsatilgan.\n\n` +
    `Kechikmasdan kelishingizni so'raymiz! Oq yo'l!`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  if (config.adminChatId) {
    const user = await getUser(ctx.from.id);
    const adminMsg = `✅ <b>Kuryer treningga kelishini tasdiqladi!</b>\n\n` +
      `• <b>Ismi:</b> <code>${user?.full_name || ctx.from.first_name}</code>\n` +
      `• <b>Telefon:</b> <code>${user?.phone_number || 'yo\'q'}</code>\n` +
      `• <b>Shahar:</b> <code>${user?.city || 'Toshkent'}</code>\n` +
      `• <b>Trening kuni:</b> <code>${user?.training_date}</code>\n` +
      `• <b>Telegram:</b> @${ctx.from.username || 'yo\'q'} (ID: <code>${ctx.from.id}</code>)`;
    await ctx.telegram.sendMessage(config.adminChatId, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
  }
});

// Handle attendance reschedule request ("Bora olmayman (Kechiktirish)")
bot.action(/^att_resched_(\d+)$/, async (ctx) => {
  const targetUserId = ctx.match[1];
  if (String(ctx.from.id) !== targetUserId) {
    return ctx.answerCbQuery('Bu tugma faqat ariza egasi uchun!', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});
  
  const nextDates = getNext5WorkingDays();
  const buttons = nextDates.map(d => [
    { text: d.name, callback_data: `resched_set_${ctx.from.id}_${d.value}` }
  ]);

  await ctx.editMessageText(
    `Hechqisi yo'q, rejangiz o'zgargan bo'lsa, trening sanasini boshqa kunga ko'chiramiz! 😊\n\n` +
    `Iltimos, o'zingizga qulay bo'lgan *yangi sanani* tanlang: 📅`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    }
  ).catch(() => {});
});

// Handle new date selection for rescheduling
bot.action(/^resched_set_(\d+)_(.+)$/, async (ctx) => {
  const targetUserId = ctx.match[1];
  const newDate = ctx.match[2];
  
  if (String(ctx.from.id) !== targetUserId) {
    return ctx.answerCbQuery('Bu tugma faqat ariza egasi uchun!', { show_alert: true });
  }

  await ctx.answerCbQuery('Sana muvaffaqiyatli ko\'chirildi!').catch(() => {});
  await rescheduleTrainingDate(ctx.from.id, newDate);

  const formattedDate = getUzbekDayName(newDate);

  await ctx.editMessageText(
    `🔄 *Trening sanasi muvaffaqiyatli o'zgartirildi!*\n\n` +
    `Siz belgilagan yangi trening kuni:\n` +
    `🗓 *${formattedDate}* soat *${config.trainingTime}* da.\n\n` +
    `Belgilangan kunda sizga qayta eslatma va aniq geolokatsiya yuboramiz. Kuningiz xayrli o'tsin! 🚀`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  if (config.adminChatId) {
    const user = await getUser(ctx.from.id);
    const adminMsg = `🔄 <b>Kuryer trening sanasini ko'chirdi!</b>\n\n` +
      `• <b>Ismi:</b> <code>${user?.full_name || ctx.from.first_name}</code>\n` +
      `• <b>Telefon:</b> <code>${user?.phone_number || 'yo\'q'}</code>\n` +
      `• <b>Shahar:</b> <code>${user?.city || 'Toshkent'}</code>\n` +
      `• <b>Yangi sana:</b> <code>${formattedDate}</code> (<code>${newDate}</code>)\n` +
      `• <b>Telegram:</b> @${ctx.from.username || 'yo\'q'} (ID: <code>${ctx.from.id}</code>)`;
    await ctx.telegram.sendMessage(config.adminChatId, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
  }
});

// Handle /help command
bot.help(async (ctx) => {
  await ctx.reply(
    `Uzum Tezkor kuryerlar ro'yxatdan o'tish boti. 🚴‍♂️\n\n` +
    `Qulay Mini App orqali anketani 1 daqiqada to'ldirishingiz mumkin.\n\n` +
    `Boshlash uchun shunchaki /start buyrug'ini yuboring.`
  );
});

// Fallback message handler for messages received outside FSM active state
bot.on('message', async (ctx) => {
  if (!ctx.scene.current) {
    await ctx.reply(
      `Uzum Tezkor kuryeri bo'lishni xohlaysizmi? Keling, ro'yxatdan o'tishni boshlaymiz! 🚀\n\n` +
      `Pastdagi tugmani bosing:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 Ro'yxatdan o'tish (Mini App)",
                web_app: { url: WEB_APP_URL }
              }
            ]
          ]
        }
      }
    );
  }
});

// Vercel Serverless Function entrypoint
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // Wait for database initialization
    await getDbInit();

    // Process update with Telegraf
    await bot.handleUpdate(req.body);
    
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
