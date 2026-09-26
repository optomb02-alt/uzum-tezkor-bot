import { Scenes, Markup } from 'telegraf';
import { 
  updateUserField, 
  completeRegistration, 
  saveUserStart 
} from './database.js';
import { 
  getTransportInlineKeyboard, 
  getCityInlineKeyboard, 
  getPhoneKeyboard, 
  getTrainingDatesInlineKeyboard,
  CITIES,
  TRANSPORTS,
  getNext5WorkingDays
} from './keyboards.js';
import { config } from './config.js';

export const COURIER_ONBOARDING_WIZARD = 'COURIER_ONBOARDING_WIZARD';

/**
 * Resets user state in DB and restarts the onboarding wizard
 */
async function restartWizard(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || '';
  await saveUserStart(userId, username);
  ctx.wizard.state = {};
  await ctx.reply(
    "Ro'yxatdan o'tish jarayoni boshidan boshlandi.\n\n" +
    "Iltimos, ism-sharifingizni to'liq yozib yuboring (masalan: Alisher Usmonov):",
    Markup.removeKeyboard()
  );
  return ctx.wizard.selectStep(1); // Set cursor to Step 1 (the name handler)
}

/**
 * Sends a POST request to Google Sheets Webhook URL
 */
async function sendWebhookSync(user) {
  if (!config.sheetsWebhookUrl) {
    console.log('ℹ️ Google Sheets Webhook URL is not configured. Skipping sync.');
    return;
  }
  
  const payload = {
    userId: user.userId,
    username: user.username,
    fullName: user.fullName,
    transport: user.transport,
    city: user.city,
    phone: user.phone,
    trainingDate: user.trainingDateValue,
    trainingDateFormatted: user.trainingDateName,
    registeredAt: new Date().toISOString()
  };
  
  try {
    console.log(`🔗 Sending webhook data for user ${user.userId}...`);
    const response = await fetch(config.sheetsWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error(`❌ Webhook sync failed with status: ${response.status}`);
    } else {
      console.log(`✅ Webhook sync successful for user ${user.userId}`);
    }
  } catch (error) {
    console.error('❌ Error sending webhook sync:', error);
  }
}

/**
 * Sends a formatted admin notification
 */
async function sendAdminNotification(ctx, user) {
  if (!config.adminChatId || config.adminChatId === 'YOUR_ADMIN_CHAT_ID_HERE') {
    console.log('ℹ️ Admin Chat ID is not configured. Skipping admin notification.');
    return;
  }
  
  const nowStr = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  const adminMessage = `🚀 *Yangi kuryer ro'yxatdan o'tdi!*

• *Ismi:* \`${user.fullName}\`
• *Transport:* \`${user.transport}\`
• *Shahar:* \`${user.city}\`
• *Telefon:* \`${user.phone}\`
• *Trening kuni:* \`${user.trainingDateName}\` (\`${user.trainingDateValue}\`)
• *Telegram:* @${user.username} (ID: \`${user.userId}\`)
• *Ro'yxatdan o'tgan vaqt:* \`${nowStr}\`
`;
  
  try {
    await ctx.telegram.sendMessage(config.adminChatId, adminMessage, { parse_mode: 'Markdown' });
    console.log(`📨 Admin notification sent for user ${user.userId}`);
  } catch (error) {
    console.error('❌ Error sending admin notification:', error);
  }
}

export const onboardingWizard = new Scenes.WizardScene(
  COURIER_ONBOARDING_WIZARD,
  
  // Step 0: Welcome message and start registration
  async (ctx) => {
    await ctx.reply(
      `Assalomu alaykum! "Uzum Tezkor" kuryerlari safi kengaymoqda! 🚀\n\n` +
      `Biz bilan hamkorlik qilib qulay ish grafigiga, barqaror haftalik daromadga va professional jamoaga ega bo'lishingiz mumkin.\n\n` +
      `Ro'yxatdan o'tishni boshlaymiz. Iltimos, to'liq ism-sharifingizni kiriting (masalan: Alisher Usmonov):`
    );
    return ctx.wizard.next();
  },

  // Step 1: Handle Full Name
  async (ctx) => {
    if (ctx.message?.text === '/start') {
      return restartWizard(ctx);
    }
    
    const fullName = ctx.message?.text?.trim();
    
    // Validate: must be text, not a command, and contain at least 2 words (e.g. Firstname Lastname)
    if (!fullName || fullName.startsWith('/') || fullName.split(/\s+/).length < 2) {
      await ctx.reply("Iltimos, ism-sharifingizni to'liq kiriting (masalan: Alisher Usmonov):");
      return;
    }
    
    // Save to DB
    await updateUserField(ctx.from.id, 'full_name', fullName);
    ctx.wizard.state.fullName = fullName;
    
    await ctx.reply(
      `Ajoyib, ${fullName}! Endi transport turini tanlang: 🚀`,
      getTransportInlineKeyboard()
    );
    return ctx.wizard.next();
  },

  // Step 2: Handle Transport Selection (Inline)
  async (ctx) => {
    if (ctx.message?.text === '/start') {
      return restartWizard(ctx);
    }

    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('transport_')) {
        const transport = data.split('_')[1];
        
        await ctx.answerCbQuery().catch(() => {});
        await updateUserField(ctx.from.id, 'transport_type', transport);
        ctx.wizard.state.transport = transport;

        // Edit original message to remove keyboard and confirm choice
        await ctx.editMessageText(`🚗 Tanlangan transport: *${transport}*`, { parse_mode: 'Markdown' }).catch(() => {});
        
        // Ask for city
        await ctx.reply(
          "Ishlash uchun qaysi shaharni tanlaysiz? Shaharni tugmalar orqali belgilang: 🏙️",
          getCityInlineKeyboard()
        );
        return ctx.wizard.next();
      } else {
        await ctx.answerCbQuery('Iltimos, joriy bosqich tugmalaridan foydalaning!').catch(() => {});
      }
    } else {
      // User sent text or off-topic input -> pivot back
      await ctx.reply(
        "Iltimos, keltirilgan tugmalardan birini bosib transportingizni tanlang: 🚀",
        getTransportInlineKeyboard()
      );
    }
  },

  // Step 3: Handle City Selection (Inline)
  async (ctx) => {
    if (ctx.message?.text === '/start') {
      return restartWizard(ctx);
    }

    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('city_')) {
        const city = data.split('_')[1];
        
        await ctx.answerCbQuery().catch(() => {});
        await updateUserField(ctx.from.id, 'city', city);
        ctx.wizard.state.city = city;

        // Edit message to confirm choice
        await ctx.editMessageText(`🏙️ Tanlangan shahar: *${city}*`, { parse_mode: 'Markdown' }).catch(() => {});
        
        // Ask for phone number
        await ctx.reply(
          "Rahmat! Telefon raqamingizni pastdagi tugma orqali ulashing yoki +998XXXXXXXXX ko'rinishida yozib yuboring: 📱",
          getPhoneKeyboard()
        );
        return ctx.wizard.next();
      } else {
        await ctx.answerCbQuery('Iltimos, joriy bosqich tugmalaridan foydalaning!').catch(() => {});
      }
    } else {
      // User sent text or off-topic input -> pivot back
      await ctx.reply(
        "Uzum Tezkor hozircha faqat ro'yxatdagi shaharlarda faoliyat yuritadi. Iltimos, tugmalar orqali shaharni tanlang: 👇",
        getCityInlineKeyboard()
      );
    }
  },

  // Step 4: Handle Phone Number
  async (ctx) => {
    if (ctx.message?.text === '/start') {
      return restartWizard(ctx);
    }
    
    let phone = '';
    if (ctx.message?.contact) {
      phone = ctx.message.contact.phone_number;
    } else if (ctx.message?.text) {
      const text = ctx.message.text.trim();
      const phoneRegex = /^\+?998\d{9}$/;
      if (phoneRegex.test(text)) {
        phone = text;
      }
    }
    
    if (!phone) {
      await ctx.reply(
        "Telefon raqami noto'g'ri. Iltimos, pastdagi tugma orqali raqamingizni ulashing yoki +998XXXXXXXXX ko'rinishida kiriting: 📱",
        getPhoneKeyboard()
      );
      return;
    }
    
    if (!phone.startsWith('+')) {
      phone = '+' + phone;
    }
    
    // Save to DB
    await updateUserField(ctx.from.id, 'phone_number', phone);
    ctx.wizard.state.phone = phone;

    // Acknowledge phone input and clear keyboard
    await ctx.reply(`📱 Telefon raqam: *${phone}*`, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
    
    // Ask for training date using inline keyboard
    await ctx.reply(
      "Trening kunini tanlang (Trening faqat dushanba-juma kunlari bo'lib o'tadi): 📅",
      getTrainingDatesInlineKeyboard()
    );
    return ctx.wizard.next();
  },

  // Step 5: Handle Training Date Selection (Inline)
  async (ctx) => {
    if (ctx.message?.text === '/start') {
      return restartWizard(ctx);
    }

    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('date_')) {
        // format is: date_YYYY-MM-DD_FormattedName
        const parts = data.split('_');
        const value = parts[1];
        const selectedDateName = parts[2];
        
        await ctx.answerCbQuery().catch(() => {});
        await updateUserField(ctx.from.id, 'training_date', value);
        await completeRegistration(ctx.from.id);

        // Edit message to confirm training date selection
        await ctx.editMessageText(`📅 Tanlangan trening kuni: *${selectedDateName}*`, { parse_mode: 'Markdown' }).catch(() => {});
        
        // Final confirmation message
        await ctx.reply(
          `Tabriklaymiz! Siz ro'yxatdan muvaffaqiyatli o'tdingiz. 🎉\n\n` +
          `Siz belgilagan trening kuni:\n*${selectedDateName}* soat *${config.trainingTime}* da.\n\n` +
          `Tez orada operatorlarimiz siz bilan bog'lanishadi. Kuningiz xayrli va barakali o'tsin! 🚀`,
          { parse_mode: 'Markdown' }
        );
        
        // Compile completed details
        const userState = {
          userId: ctx.from.id,
          username: ctx.from.username || 'mavjud_emas',
          fullName: ctx.wizard.state.fullName,
          transport: ctx.wizard.state.transport,
          city: ctx.wizard.state.city,
          phone: ctx.wizard.state.phone,
          trainingDateName: selectedDateName,
          trainingDateValue: value
        };
        
        // Notify admin and sheets Webhook
        await sendAdminNotification(ctx, userState);
        await sendWebhookSync(userState);
        
        return ctx.scene.leave();
      } else {
        await ctx.answerCbQuery('Iltimos, joriy bosqich tugmalaridan foydalaning!').catch(() => {});
      }
    } else {
      // User sent text or off-topic input -> pivot back
      await ctx.reply(
        "Iltimos, taklif etilgan trening kunlaridan birini tanlang: 📅",
        getTrainingDatesInlineKeyboard()
      );
    }
  }
);
