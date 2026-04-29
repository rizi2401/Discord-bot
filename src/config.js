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

const parseList = (value, fallback = "") => {
  return String(value ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseEnum = (value, allowed, fallback) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
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
    adminRoleKeys: parseList(process.env.SONARA_ADMIN_ROLE_KEYS, "admin,founder"),
    discordIdColumn: parseIdentifier(process.env.SONARA_DISCORD_ID_COLUMN, "discord_user_id"),
    displayNameColumn: parseIdentifier(process.env.SONARA_DISPLAY_NAME_COLUMN, "display_name"),
    headRoleKeys: parseList(process.env.SONARA_HEAD_ROLE_KEYS, "head-moderator"),
    loginColumn: parseIdentifier(process.env.SONARA_LOGIN_COLUMN, "username"),
    moderatorRoleKeys: parseList(
      process.env.SONARA_MODERATOR_ROLE_KEYS,
      "moderator,head-moderator"
    ),
    passwordHashColumn: parseIdentifier(
      process.env.SONARA_PASSWORD_HASH_COLUMN,
      "password_hash"
    ),
    passwordMode: parseEnum(
      process.env.SONARA_PASSWORD_MODE,
      ["bcrypt", "plain", "bcrypt_or_plain"],
      "bcrypt_or_plain"
    ),
    roleKeyColumn: parseIdentifier(process.env.SONARA_ROLE_KEY_COLUMN, "slug"),
    roleNameColumn: parseIdentifier(process.env.SONARA_ROLE_NAME_COLUMN, "name"),
    rolesTable: parseIdentifier(process.env.SONARA_ROLES_TABLE, "roles"),
    schema: parseIdentifier(process.env.SONARA_SCHEMA, "public"),
    shiftClockingColumn: parseIdentifier(
      process.env.SONARA_SHIFT_CLOCKING_COLUMN,
      "requires_clocking"
    ),
    shiftEndColumn: parseIdentifier(process.env.SONARA_SHIFT_END_COLUMN, "ends_at"),
    shiftNotesColumn: parseIdentifier(process.env.SONARA_SHIFT_NOTES_COLUMN, "notes"),
    shiftStatusColumn: parseIdentifier(
      process.env.SONARA_SHIFT_STATUS_COLUMN,
      "status",
      { optional: true }
    ),
    shiftTable: parseIdentifier(process.env.SONARA_SHIFTS_TABLE, "shifts"),
    shiftTeamKeyColumn: parseIdentifier(process.env.SONARA_SHIFT_TEAM_KEY_COLUMN, "team_key"),
    shiftUpdatedAtColumn: parseIdentifier(
      process.env.SONARA_SHIFT_UPDATED_AT_COLUMN,
      "updated_at"
    ),
    shiftUserIdColumn: parseIdentifier(process.env.SONARA_SHIFT_USER_ID_COLUMN, "user_id"),
    shiftActiveStatuses: parseList(
      process.env.SONARA_SHIFT_ACTIVE_STATUSES,
      "planned,confirmed"
    ),
    shiftStartColumn: parseIdentifier(process.env.SONARA_SHIFT_START_COLUMN, "starts_at"),
    userActiveColumn: parseIdentifier(
      process.env.SONARA_ACTIVE_COLUMN,
      "is_active",
      { optional: true }
    ),
    userRolesTable: parseIdentifier(process.env.SONARA_USER_ROLES_TABLE, "user_roles"),
    usersTable: parseIdentifier(process.env.SONARA_USERS_TABLE, "users")
  }
};
