# Uzum Tezkor Onboarding Telegram Bot (Vercel Serverless & PostgreSQL)

This is a production-ready Telegram Bot for the **"Tezkor Courier"** referral onboarding program. It is optimized to run on **Vercel** as a **Serverless Function (Webhooks)**, storing user progress and final answers in a **PostgreSQL** database (e.g., Supabase, Neon, or Vercel Postgres) and triggering background reminders via **Vercel Cron Jobs**.

---

## 🚀 Tech Stack & Core Features

- **Platform:** Vercel (Serverless Functions)
- **Telegram Bot Framework:** [Telegraf](https://github.com/telegraf/telegraf) (v4)
- **Database:** PostgreSQL (with `pg` Client connection pool and SSL support)
- **Cron Tasks:** Vercel Cron Jobs (runs reminders via scheduled HTTP triggers)
- **State Machine (FSM):** Telegraf Wizards (handles flow state robustly)
- **Third-party integrations:** Native `fetch()` Webhook triggers for Google Sheets syncing

---

## 📂 Project Structure

```
Uzum Tezkor/
├── .env                  # Local secrets template (for dev)
├── config.js             # Configuration parser and validator
├── database.js           # PostgreSQL schema migration and query operators
├── keyboards.js          # Interactive Uzbek inline keyboards
├── scenes.js             # Onboarding Wizard FSM (5 data points collected sequentially)
├── vercel.json           # Vercel deployment and Cron Jobs configuration
├── api/
│   ├── bot.js            # Vercel Serverless Function (Telegram Webhook entrypoint)
│   └── cron.js           # Vercel Serverless Function (Vercel Cron reminders endpoint)
├── package.json          # Dependency definition and npm scripts
├── test_vercel.js        # Validation script for serverless syntax and queries
└── README.md             # Deploy & setup instructions (this file)
```

---

## ⚙️ Configuration (Environment Variables)

When deploying to Vercel, you need to set the following **Environment Variables** in your Vercel Project Settings:

| Variable | Description | Example |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `8678557332:AAFKFrTfxt3...` |
| `ADMIN_CHAT_ID` | Telegram chat ID for admin notifications | `819931801` |
| `DATABASE_URL` | PostgreSQL connection string (Supabase or Neon) | `postgresql://user:pass@host:5432/db` |
| `CRON_SECRET` | Secret token to secure `/api/cron` endpoint | `my_secure_random_string_123` |
| `SHEETS_WEBHOOK_URL` | (Optional) URL to sync completed registrations to Sheets | `https://script.google.com/...` |
| `TRAINING_TIME` | Daily training start time (default `10:00`) | `10:00` |

---

## 🛠️ Setup & Deployment Guide

### 1. Database Provisioning
Set up a free PostgreSQL database:
* **Option A: Supabase**
  1. Register at [supabase.com](https://supabase.com) and create a new project.
  2. Go to **Project Settings -> Database** and copy the **Connection string** (URI format).
* **Option B: Neon**
  1. Register at [neon.tech](https://neon.tech) and create a project.
  2. Copy the **Connection String** from the dashboard.

Add this connection string to `DATABASE_URL` in your `.env` (locally) or Vercel Settings.

### 2. Deploy to Vercel
1. Push this workspace to your GitHub/GitLab/Bitbucket repository.
2. Go to [vercel.com](https://vercel.com) and import the repository.
3. In **Environment Variables**, add the variables defined in the table above.
4. Click **Deploy**. Vercel will create your serverless functions under `/api/bot` and `/api/cron`.

### 3. Set the Telegram Webhook
To tell Telegram to route incoming messages to Vercel, visit this URL in your web browser (replace values with your token and Vercel domain):
```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR-VERCEL-DOMAIN>.vercel.app/api/bot
```
Make sure you receive a success message: `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 4. Background Cron Job Reminders
The `vercel.json` file schedules Vercel to automatically hit `/api/cron` once per day (`0 0 * * *`) to satisfy Vercel Hobby (free) plan deployment validators:
```json
{
  "version": 2,
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "0 0 * * *"
    }
  ]
}
```

#### 💡 Free Workaround for 5-Minute Reminders (Highly Recommended)
Since Vercel Hobby restricts internal cron executions to once a day, you can use a free external service like **[cron-job.org](https://cron-job.org)** to trigger the endpoint every 5 minutes:
1. Register a free account at [cron-job.org](https://cron-job.org).
2. Create a new Cron Job with these settings:
   - **Title:** `Uzum Tezkor Reminders`
   - **URL:** `https://<YOUR-VERCEL-DOMAIN>.vercel.app/api/cron`
   - **Schedule:** Every 5 minutes (or 10 minutes)
   - **Request Headers:** Add a header named `Authorization` with value `Bearer <YOUR_CRON_SECRET>` (replace `<YOUR_CRON_SECRET>` with the same secret you entered in your Vercel Environment Variables).
3. Save the cron job. It will trigger the serverless function securely in the background.

* **30-Minute Retargeting Nudge:** Checks for users who triggered `/start` but remained in an `incomplete` status for over 30 minutes. It sends:
  > "Ismingizni kiritish yodingizdan chiqdimi? 🤔\n\nUzum Tezkor kuryerlari jamoasida sizni intizorlik bilan kutyapmiz!..."
* **12-Hour Training Reminder:** Calculates the exact training time using the user's `training_date` (e.g. `2026-07-06`) and the global `TRAINING_TIME` (e.g. `10:00`). If the current time enters the 12-hour window before the training session (e.g. 10:00 PM the night before), it sends:
  > "Eslatma! Treningingiz boshlanishiga oz fursat qoldi! 📅\n\nSiz tanlagan trening kuni va vaqti: ..."

---

## 🔬 Local Validation & Development

To test the codebase syntax and dynamic weekdays generators locally:
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run validation check:
   ```bash
   npm test
   ```
*(If you fill `DATABASE_URL` in your local `.env`, the script will also verify active connections, run migrations, and test database inserts/updates against your cloud Postgres instance.)*

---

## 🔗 Google Sheets Integration Webhook (App Script Template)
Configure a Google Apps Script linked to your spreadsheet and set the deployment URL in `SHEETS_WEBHOOK_URL` in Vercel:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    sheet.appendRow([
      new Date(data.registeredAt),
      data.userId,
      "@" + data.username,
      data.fullName,
      data.transport,
      data.city,
      data.phone,
      data.trainingDate,
      data.trainingDateFormatted
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```
