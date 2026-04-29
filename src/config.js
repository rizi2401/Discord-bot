import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

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

const parseIdentifier = (value, fallback, { optional = false } = {}) => {
  const raw = String(value ?? fallback ?? "").trim();

  if (!raw && optional) {
    return "";
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    throw new Error(
      `Invalid SQL identifier "${raw}". Only letters, numbers and underscores are allowed.`
    );
  }

  return raw;
};

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID", "DATABASE_URL", "SESSION_SECRET"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

export const config = {
  botBaseUrl: String(process.env.BOT_BASE_URL ?? "").replace(/\/+$/, ""),
  botSchema: parseIdentifier(process.env.BOT_SCHEMA, "bot_ops"),
  checkinGraceMinutes: parseInteger(process.env.CHECKIN_GRACE_MINUTES, 15),
  checkoutGraceMinutes: parseInteger(process.env.CHECKOUT_GRACE_MINUTES, 30),
  clientId: String(process.env.CLIENT_ID),
  databaseUrl: String(process.env.DATABASE_URL),
  discordToken: String(process.env.DISCORD_TOKEN),
  guildId: String(process.env.GUILD_ID),
  importApiSecret: String(process.env.IMPORT_API_SECRET ?? "").trim(),
  port: parseInteger(process.env.PORT, 3000),
  reminderMinutesBefore: parseReminderMinutes(process.env.REMINDER_MINUTES_BEFORE),
  sessionSecret: String(process.env.SESSION_SECRET),
  shiftLookaheadDays: parseInteger(process.env.SHIFT_LOOKAHEAD_DAYS, 30),
  shiftLookbackHours: parseInteger(process.env.SHIFT_LOOKBACK_HOURS, 12),
  timezone: String(process.env.TIMEZONE ?? "Europe/Berlin"),
  voiceRoomIdleMinutes: parseInteger(process.env.VOICE_ROOM_IDLE_MINUTES, 10),
  sonara: {
    blockedColumn: parseIdentifier(process.env.SONARA_BLOCKED_COLUMN, "is_blocked", {
      optional: true
    }),
    dateKeyColumn: parseIdentifier(process.env.SONARA_SHIFT_DATE_COLUMN, "date_key"),
    discordIdColumn: parseIdentifier(process.env.SONARA_DISCORD_ID_COLUMN, "discord_user_id"),
    discordNameColumn: parseIdentifier(
      process.env.SONARA_DISCORD_NAME_COLUMN,
      "discord_name",
      { optional: true }
    ),
    displayNameColumn: parseIdentifier(process.env.SONARA_DISPLAY_NAME_COLUMN, "display_name"),
    loginColumn: parseIdentifier(process.env.SONARA_LOGIN_COLUMN, "username"),
    passwordHashColumn: parseIdentifier(
      process.env.SONARA_PASSWORD_HASH_COLUMN,
      "password_hash"
    ),
    roleColumn: parseIdentifier(process.env.SONARA_ROLE_COLUMN, "role"),
    schema: parseIdentifier(process.env.SONARA_SCHEMA, "public"),
    shiftEndTimeColumn: parseIdentifier(process.env.SONARA_SHIFT_END_TIME_COLUMN, "end_time"),
    shiftIdColumn: parseIdentifier(process.env.SONARA_SHIFT_ID_COLUMN, "id"),
    shiftIsLeadColumn: parseIdentifier(process.env.SONARA_SHIFT_IS_LEAD_COLUMN, "is_lead", {
      optional: true
    }),
    shiftMemberIdColumn: parseIdentifier(
      process.env.SONARA_SHIFT_MEMBER_ID_COLUMN,
      "member_id"
    ),
    shiftNotesColumn: parseIdentifier(process.env.SONARA_SHIFT_NOTES_COLUMN, "notes", {
      optional: true
    }),
    shiftStartTimeColumn: parseIdentifier(
      process.env.SONARA_SHIFT_START_TIME_COLUMN,
      "start_time"
    ),
    shiftTable: parseIdentifier(process.env.SONARA_SHIFTS_TABLE, "shifts"),
    shiftTaskColumn: parseIdentifier(process.env.SONARA_SHIFT_TASK_COLUMN, "task", {
      optional: true
    }),
    shiftTypeColumn: parseIdentifier(
      process.env.SONARA_SHIFT_TYPE_COLUMN,
      "shift_type",
      { optional: true }
    ),
    shiftUpdatedAtColumn: parseIdentifier(
      process.env.SONARA_SHIFT_UPDATED_AT_COLUMN,
      "updated_at",
      { optional: true }
    ),
    shiftWorldColumn: parseIdentifier(process.env.SONARA_SHIFT_WORLD_COLUMN, "world", {
      optional: true
    }),
    timeEntryCheckInColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_CHECKIN_COLUMN,
      "check_in_at"
    ),
    timeEntryCheckOutColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_CHECKOUT_COLUMN,
      "check_out_at"
    ),
    timeEntryCreatedAtColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_CREATED_AT_COLUMN,
      "created_at",
      { optional: true }
    ),
    timeEntryIdColumn: parseIdentifier(process.env.SONARA_TIME_ENTRY_ID_COLUMN, "id"),
    timeEntryShiftIdColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_SHIFT_ID_COLUMN,
      "shift_id",
      { optional: true }
    ),
    timeEntryShiftSnapshotColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_SHIFT_SNAPSHOT_COLUMN,
      "shift_snapshot",
      { optional: true }
    ),
    timeEntrySortIndexColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_SORT_INDEX_COLUMN,
      "sort_index",
      { optional: true }
    ),
    timeEntryTable: parseIdentifier(process.env.SONARA_TIME_ENTRIES_TABLE, "time_entries"),
    timeEntryUserIdColumn: parseIdentifier(
      process.env.SONARA_TIME_ENTRY_USER_ID_COLUMN,
      "user_id"
    ),
    usersTable: parseIdentifier(process.env.SONARA_USERS_TABLE, "users"),
    userIdColumn: parseIdentifier(process.env.SONARA_USER_ID_COLUMN, "id"),
    vrchatNameColumn: parseIdentifier(
      process.env.SONARA_VRCHAT_NAME_COLUMN,
      "vrchat_name",
      { optional: true }
    )
  }
};
