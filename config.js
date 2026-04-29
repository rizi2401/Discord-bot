import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseReminderMinutes = (value, fallback = [1440, 60, 15]) => {
  const parsed = String(value ?? "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((left, right) => right - left);

  return parsed.length > 0 ? parsed : fallback;
};

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

export const config = {
  botToWebsiteSecret: process.env.BOT_TO_WEBSITE_SECRET ?? "",
  checkinGraceMinutes: parseInteger(process.env.CHECKIN_GRACE_MINUTES, 15),
  checkoutGraceMinutes: parseInteger(process.env.CHECKOUT_GRACE_MINUTES, 30),
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET ?? "",
  databaseFile: path.resolve(
    projectRoot,
    process.env.DATABASE_FILE ?? "./data/operations-bot.sqlite"
  ),
  discordToken: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  panelBaseUrl: (process.env.PANEL_BASE_URL ?? "").replace(/\/+$/, ""),
  port: parseInteger(process.env.PORT, 3000),
  reminderMinutesBefore: parseReminderMinutes(process.env.REMINDER_MINUTES_BEFORE),
  sessionSecret:
    process.env.SESSION_SECRET ??
    process.env.WEBHOOK_SECRET ??
    "operations-discord-bot-development-secret",
  timezone: process.env.TIMEZONE ?? "Europe/Berlin",
  voiceRoomIdleMinutes: parseInteger(process.env.VOICE_ROOM_IDLE_MINUTES, 10),
  websiteToBotSecret: process.env.WEBSITE_TO_BOT_SECRET ?? process.env.WEBHOOK_SECRET ?? ""
};
