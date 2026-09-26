import { Telegraf, Scenes } from 'telegraf';
import { config } from '../config.js';
import { 
  initDb, 
  saveUserStart, 
  pgSessionMiddleware,
  getUser,
  updateAttendanceStatus,
  rescheduleTrainingDate,
  getRegistrationStats,
  getUsersForExport,
  generateCsvContent
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

// Admin authentication helper
function isAdmin(ctx) {
  if (!config.adminChatId || config.adminChatId === 'YOUR_ADMIN_CHAT_ID_HERE') {
    return true; // Allow for testing if not explicitly configured
  }
  const senderId = String(ctx.from?.id || '');
  const chatId = String(ctx.chat?.id || '');
  const adminIds = String(config.adminChatId).split(',').map(s => s.trim());
  return adminIds.includes(senderId) || adminIds.includes(chatId);
}

// Stats message formatting helper
async function buildStatsMessage() {
  const stats = await getRegistrationStats();
  const nowStr = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });

  const cityText = stats.byCity.length > 0 
    ? stats.byCity.map(c => `  • ${c.city}: *${c.count}* ta`).join('\n') 
    : '  • Ma\'lumot mavjud emas';

  const transportText = stats.byTransport.length > 0 
    ? stats.byTransport.map(t => `  • ${t.transport}: *${t.count}* ta`).join('\n') 
    : '  • Ma\'lumot mavjud emas';

  const attText = stats.attendance.length > 0 
    ? stats.attendance.map(a => `  • ${a.status}: *${a.count}* ta`).join('\n') 
    : '  • Ma\'lumot mavjud emas';

  return `📊 *UZUM TEZKOR — KURYERLAR STATISTIKASI*\n\n` +
    `👥 *Jami to'liq ro'yxatdan o'tganlar:* *${stats.total}* nafar\n` +
    `📅 *Bugungi yangi arizalar:* *${stats.today}* ta\n` +
    `🗓 *Shu haftadagi arizalar:* *${stats.week}* ta\n` +
    `🎯 *Bugungi trening ishtirokchilari:* *${stats.todayTraining}* ta\n\n` +
    `🏙 *Shaharlar kesimida:*\n${cityText}\n\n` +
    `🚗 *Transport turlari bo'yicha:*\n${transportText}\n\n` +
    `📋 *Davomat holati:*\n${attText}\n\n` +
    `⏱ *Yangilangan vaqt:* \`${nowStr}\``;
}

// Handle /stats command
bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("Kechirasiz, ushbu buyruq faqat loyiha ma'murlari uchun ruxsat etilgan. 🔒");
  }

  const message = await buildStatsMessage();

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📥 Excel (CSV) eksport", callback_data: "admin_export_menu" },
          { text: "🔄 Yangilash", callback_data: "admin_stats_refresh" }
        ]
      ]
    }
  });
});

// Refresh stats in place
bot.action('admin_stats_refresh', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Faqat adminlar uchun!', { show_alert: true });
  }

  await ctx.answerCbQuery('Statistika yangilandi!').catch(() => {});
  const message = await buildStatsMessage();

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📥 Excel (CSV) eksport", callback_data: "admin_export_menu" },
          { text: "🔄 Yangilash", callback_data: "admin_stats_refresh" }
        ]
      ]
    }
  }).catch(() => {});
});

// Handle /export command
bot.command('export', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("Kechirasiz, ushbu buyruq faqat loyiha ma'murlari uchun ruxsat etilgan. 🔒");
  }

  await ctx.reply(
    `📥 *Kuryerlar ro'yxatini Excel formatida yuklab olish*\n\n` +
    `Qaysi davr bo'yicha arizalarni yuklab olmoqchisiz? Tanlang: 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Bugungi arizalar", callback_data: "export_run_today" },
            { text: "🗓 Shu haftadagi", callback_data: "export_run_week" }
          ],
          [
            { text: "📊 Barcha kuryerlar ro'yxati", callback_data: "export_run_all" }
          ]
        ]
      }
    }
  );
});

// Open export menu from stats action
bot.action('admin_export_menu', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Faqat adminlar uchun!', { show_alert: true });
  }
  await ctx.answerCbQuery().catch(() => {});

  await ctx.reply(
    `📥 *Kuryerlar ro'yxatini Excel formatida yuklab olish*\n\n` +
    `Qaysi davr bo'yicha arizalarni yuklab olmoqchisiz? Tanlang: 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Bugungi arizalar", callback_data: "export_run_today" },
            { text: "🗓 Shu haftadagi", callback_data: "export_run_week" }
          ],
          [
            { text: "📊 Barcha kuryerlar ro'yxati", callback_data: "export_run_all" }
          ]
        ]
      }
    }
  );
});

// Export execution helper
async function handleExportAction(ctx, filter, label) {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Faqat adminlar uchun!', { show_alert: true });
  }

  await ctx.answerCbQuery(`Excel fayl tayyorlanmoqda...`).catch(() => {});

  try {
    const users = await getUsersForExport(filter);
    
    if (users.length === 0) {
      return ctx.reply(`ℹ️ Tanlangan davr (${label}) bo'yicha hech qanday ariza topilmadi.`);
    }

    const csvData = generateCsvContent(users);
    const nowStr = new Date().toISOString().split('T')[0];
    const filename = `kuryerlar_${filter}_${nowStr}.csv`;

    await ctx.replyWithDocument({
      source: Buffer.from('\uFEFF' + csvData, 'utf-8'),
      filename: filename
    }, {
      caption: `📁 *Kuryerlar ro'yxati (${label})*\n\n` +
        `• Jami kuryerlar: *${users.length}* nafar\n` +
        `• Fayl formati: Excel / CSV (UTF-8)\n` +
        `• Yuklab olingan vaqt: \`${new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}\``,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Export error:', err);
    await ctx.reply(`❌ Eksport qilishda xatolik yuz berdi: ${err.message}`);
  }
}

bot.action('export_run_today', (ctx) => handleExportAction(ctx, 'today', 'Bugun'));
bot.action('export_run_week', (ctx) => handleExportAction(ctx, 'week', 'Shu hafta'));
bot.action('export_run_all', (ctx) => handleExportAction(ctx, 'all', 'Barchasi'));

// Handle /help command
bot.help(async (ctx) => {
  let helpMsg = 
    `🚴‍♂️ *Uzum Tezkor kuryerlar ro'yxatdan o'tish boti*\n\n` +
    `• /start — Ro'yxatdan o'tishni boshlash (Mini App)\n` +
    `• /help — Bot bo'yicha qo'llanma`;

  if (isAdmin(ctx)) {
    helpMsg += `\n\n👑 *Admin buyruqlari:*\n` +
      `• /stats — Real vaqtli arizalar statistikasi\n` +
      `• /export — Nomzodlar ro'yxatini Excel (.csv) formatida yuklab olish`;
  }

  await ctx.reply(helpMsg, { parse_mode: 'Markdown' });
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
