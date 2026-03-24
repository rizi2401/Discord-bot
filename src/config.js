import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const parseReminderMinutes = (value) => {
  return String(value ?? "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((left, right) => right - left);
};

const required = ["DISCORD_TOKEN", "CLIENT_ID", "WEBHOOK_SECRET"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

export const config = {
  clientId: process.env.CLIENT_ID,
  dataFile: path.resolve(projectRoot, process.env.DATA_FILE ?? "./data/shifts.json"),
  discordToken: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID ?? "",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  reminderChannelId: process.env.REMINDER_CHANNEL_ID ?? "",
  reminderMinutesBefore: parseReminderMinutes(process.env.REMINDER_MINUTES_BEFORE ?? "1440,60,15"),
  timezone: process.env.TIMEZONE ?? "Europe/Berlin",
  webhookSecret: process.env.WEBHOOK_SECRET
};
