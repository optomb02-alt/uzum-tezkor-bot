import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env for local development
dotenv.config({ path: path.join(__dirname, '.env') });

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  adminChatId: process.env.ADMIN_CHAT_ID || '',
  databaseUrl: process.env.DATABASE_URL || '',
  sheetsWebhookUrl: process.env.SHEETS_WEBHOOK_URL || '',
  trainingTime: process.env.TRAINING_TIME || '10:00',
  cronSecret: process.env.CRON_SECRET || '',
};

// Log startup warnings for misconfigurations
if (!config.botToken) {
  console.warn('⚠️ WARNING: TELEGRAM_BOT_TOKEN is not set!');
}
if (!config.adminChatId) {
  console.warn('⚠️ WARNING: ADMIN_CHAT_ID is not set!');
}
if (!config.databaseUrl) {
  console.warn('⚠️ WARNING: DATABASE_URL is not set! PostgreSQL database operations will fail.');
}
