import { Telegraf, Scenes } from 'telegraf';
import { config } from '../config.js';
import { initDb, saveUserStart, pgSessionMiddleware } from '../database.js';
import { onboardingWizard, COURIER_ONBOARDING_WIZARD } from '../scenes.js';

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
