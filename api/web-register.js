import { getPool } from '../database.js';
import { config } from '../config.js';

/**
 * Helper to calculate Uzbek day names for the training date formatting
 */
function getUzbekDayName(dateStr) {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const dayNamesUz = {
      1: 'Dushanba',
      2: 'Seshanba',
      3: 'Chorshanba',
      4: 'Payshanba',
      5: 'Juma',
      6: 'Shanba',
      0: 'Yakshanba'
    };
    
    const d = String(day).padStart(2, '0');
    const m = String(month).padStart(2, '0');
    const y = year;
    
    return `${dayNamesUz[dayOfWeek] || 'Trening'} (${d}.${m}.${y})`;
  } catch (err) {
    return dateStr;
  }
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
    console.log(`🔗 Sending sheets webhook sync for user ${user.userId}...`);
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
 * Sends formatted telegram admin notification
 */
async function sendAdminNotification(user) {
  if (!config.botToken || !config.adminChatId || config.adminChatId === 'YOUR_ADMIN_CHAT_ID_HERE') {
    console.log('ℹ️ Admin credentials not set. Skipping Telegram notification.');
    return;
  }
  
  const nowStr = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  const typeLabel = user.isMiniApp ? 'Telegram Mini App orqali' : 'Veb-sayt orqali';
  const typeDetails = user.isMiniApp 
    ? `Telegram Mini App (@${user.username || 'yo\'q'} | ID: <code>${user.userId}</code>)`
    : `Veb-sayt formasi (ID: <code>${user.userId}</code>)`;

  const adminMessage = `🚀 <b>Yangi kuryer ro'yxatdan o'tdi (${typeLabel})!</b>\n\n` +
                       `• <b>Ismi:</b> <code>${user.fullName}</code>\n` +
                       `• <b>Transport:</b> <code>${user.transport}</code>\n` +
                       `• <b>Shahar:</b> <code>${user.city}</code>\n` +
                       `• <b>Telefon:</b> <code>${user.phone}</code>\n` +
                       `• <b>Trening kuni:</b> <code>${user.trainingDateName}</code> (<code>${user.trainingDateValue}</code>)\n` +
                       `• <b>Turi:</b> ${typeDetails}\n` +
                       `• <b>Sana:</b> <code>${nowStr}</code>`;
  
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.adminChatId,
        text: adminMessage,
        parse_mode: 'HTML'
      })
    });
    console.log(`📨 Admin notification sent for user ${user.userId}`);
  } catch (error) {
    console.error('❌ Error sending admin notification:', error);
  }
}

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { 
    fullName, 
    transport, 
    city, 
    phone, 
    trainingDate,
    userId: incomingUserId,
    username: incomingUsername
  } = req.body;

  // 1. Validation
  if (!fullName || !transport || !city || !phone || !trainingDate) {
    return res.status(400).json({ success: false, message: 'Barcha maydonlarni to\'ldirish shart!' });
  }

  if (fullName.trim().split(/\s+/).length < 2) {
    return res.status(400).json({ success: false, message: 'Ism va familiyangizni to\'liq kiriting!' });
  }

  if (!/^\+998\d{9}$/.test(phone.trim())) {
    return res.status(400).json({ success: false, message: 'Telefon raqam noto\'g\'ri formatda!' });
  }

  try {
    const pool = getPool();
    const now = Math.floor(Date.now() / 1000);
    
    const isMiniApp = !!(incomingUserId && Number(incomingUserId) > 0);
    const effectiveUserId = isMiniApp 
      ? Number(incomingUserId) 
      : (-Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 1000));
    const effectiveUsername = isMiniApp ? (incomingUsername || '') : 'web_form';
    const trainingDateFormatted = getUzbekDayName(trainingDate);

    // 2. Save User to PostgreSQL users table
    const query = `
      INSERT INTO users (
        user_id, username, full_name, transport_type, city, phone_number, training_date, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9)
      ON CONFLICT (user_id) DO UPDATE SET
        username = EXCLUDED.username,
        full_name = EXCLUDED.full_name,
        transport_type = EXCLUDED.transport_type,
        city = EXCLUDED.city,
        phone_number = EXCLUDED.phone_number,
        training_date = EXCLUDED.training_date,
        status = 'completed',
        updated_at = EXCLUDED.updated_at
    `;
    
    await pool.query(query, [
      effectiveUserId,
      effectiveUsername,
      fullName.trim(),
      transport,
      city,
      phone.trim(),
      trainingDate,
      now,
      now
    ]);

    console.log(`💾 Registration saved to PG (isMiniApp: ${isMiniApp}) with ID: ${effectiveUserId}`);

    const userObj = {
      userId: effectiveUserId,
      username: effectiveUsername,
      fullName: fullName.trim(),
      transport: transport,
      city: city,
      phone: phone.trim(),
      trainingDateValue: trainingDate,
      trainingDateName: trainingDateFormatted,
      isMiniApp
    };

    // 3. Sync to Google Sheets
    await sendWebhookSync(userObj);

    // 4. Send Telegram Admin Notification
    await sendAdminNotification(userObj);

    // 5. If registered via Telegram Mini App, send direct confirmation message to user
    if (isMiniApp && config.botToken) {
      try {
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: effectiveUserId,
            text: `Tabriklaymiz! Siz ro'yxatdan muvaffaqiyatli o'tdingiz. 🎉\n\n` +
                  `Siz belgilagan trening kuni:\n🗓 *${trainingDateFormatted}* soat *${config.trainingTime}* da.\n\n` +
                  `Tez orada operatorlarimiz siz bilan bog'lanishadi. Kuningiz xayrli va barakali o'tsin! 🚀`,
            parse_mode: 'Markdown'
          })
        });
        console.log(`✉️ Direct Telegram confirmation sent to user ${effectiveUserId}`);
      } catch (userMsgErr) {
        console.error('Failed to send confirmation message to user:', userMsgErr.message);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Muvaffaqiyatli ro\'yxatdan o\'tdingiz!' 
    });

  } catch (error) {
    console.error('❌ Web registration handler failed:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Bazada xatolik yuz berdi. Iltimos qayta urinib ko\'ring.' 
    });
  }
}
