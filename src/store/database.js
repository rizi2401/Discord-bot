import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const DEFAULT_SHIFT_DM_ROLE = "moderator";
const HUB_ACCESS_ROLES = new Set(["admin", "moderator", "moderation_lead"]);

const asIso = (value = new Date()) => {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const hashToken = (value) => {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
};

const quoteIdentifier = (identifier) => {
  return `"${String(identifier).replaceAll('"', '""')}"`;
};

const qualify = (schema, table) => {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
};

const parseDateKey = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const pad = (value) => String(value).padStart(2, "0");

const addDaysToDateKey = (dateKey, days) => {
  const [year, month, day] = String(dateKey).split("-").map((item) => Number.parseInt(item, 10));
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return [
    utcDate.getUTCFullYear(),
    pad(utcDate.getUTCMonth() + 1),
    pad(utcDate.getUTCDate())
  ].join("-");
};

const parseTimeText = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) {
    throw new Error(`Invalid Sonara time value "${text}".`);
  }

  return {
    hours: Number.parseInt(match[1], 10),
    minutes: Number.parseInt(match[2], 10),
    seconds: Number.parseInt(match[3] ?? "0", 10)
  };
};

const timeToComparable = (value) => {
  const parts = parseTimeText(value);
  return parts.hours * 3600 + parts.minutes * 60 + parts.seconds;
};

const getTimeZoneParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number.parseInt(part.value, 10)])
  );
};

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
};

const zonedDateTimeToIso = ({ dateKey, timeText, timeZone }) => {
  const [year, month, day] = String(dateKey).split("-").map((item) => Number.parseInt(item, 10));
  const { hours, minutes, seconds } = parseTimeText(timeText);
  const naiveUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const initialGuess = new Date(naiveUtc);
  const offset = getTimeZoneOffsetMs(initialGuess, timeZone);
  let actual = new Date(naiveUtc - offset);
  const correctedOffset = getTimeZoneOffsetMs(actual, timeZone);

  if (correctedOffset !== offset) {
    actual = new Date(naiveUtc - correctedOffset);
  }

  return actual.toISOString();
};

const toNullableString = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
};

const humanizeRole = (role) => {
  const roleMap = {
    admin: "Admin",
    member: "Member",
    moderation_lead: "Moderation Lead",
    moderator: "Moderator",
    planner: "Planner"
  };

  return roleMap[role] ?? role;
};

const toRoleFlags = (role) => {
  const normalizedRole = String(role ?? "").trim();
  const isAdmin = normalizedRole === "admin";
  const isHead = normalizedRole === "moderation_lead";
  const isModerator = normalizedRole === "moderator" || normalizedRole === "moderation_lead";

  return {
    canAccessHub: HUB_ACCESS_ROLES.has(normalizedRole),
    isAdmin,
    isHead,
    isModerator
  };
};

const getDefaultShiftDmEnabled = (role) => {
  return String(role ?? "").trim().toLowerCase() === DEFAULT_SHIFT_DM_ROLE;
};

const verifyScryptPassword = (password, storedHash) => {
  const [salt, hash] = String(storedHash ?? "").split(":", 2);

  if (!salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const derived = scryptSync(String(password ?? ""), salt, expected.length);

  return expected.length === derived.length && timingSafeEqual(expected, derived);
};

const normalizeImportedShift = (shift) => {
  if (!shift || typeof shift !== "object") {
    throw new Error("Shift must be an object.");
  }

  const id = String(shift.id ?? "").trim();
  const moderatorName = String(shift.moderatorName ?? "").trim();
  const startsAt = String(shift.startsAt ?? "").trim();
  const endsAt = String(shift.endsAt ?? "").trim();

  if (!id) {
    throw new Error("Shift is missing id.");
  }

  if (!moderatorName) {
    throw new Error(`Shift ${id} is missing moderatorName.`);
  }

  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    throw new Error(`Shift ${id} has an invalid startsAt value.`);
  }

  if (!endsAt || Number.isNaN(Date.parse(endsAt))) {
    throw new Error(`Shift ${id} has an invalid endsAt value.`);
  }

  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error(`Shift ${id} ends before it starts.`);
  }

  const userRole = String(shift.userRole ?? shift.teamKey ?? "").trim().toLowerCase();

  return {
    discordUserId: String(shift.discordUserId ?? "").trim(),
    endsAt: asIso(endsAt),
    id,
    isLead: Boolean(shift.isLead),
    moderatorName,
    notes: String(shift.notes ?? "").trim(),
    requiresClocking: shift.requiresClocking === false ? false : true,
    shiftType: String(shift.shiftType ?? "").trim(),
    sonaraUserId: String(shift.sonaraUserId ?? "").trim(),
    startsAt: asIso(startsAt),
    task: String(shift.task ?? "").trim(),
    teamKey: String(shift.teamKey ?? userRole).trim(),
    updatedAt: shift.updatedAt ? asIso(shift.updatedAt) : asIso(),
    userRole,
    world: String(shift.world ?? "").trim()
  };
};

const shiftChanged = (left, right) => {
  return (
    left.sonara_user_id !== right.sonaraUserId ||
    left.user_role !== right.userRole ||
    left.team_key !== right.teamKey ||
    left.moderator_name !== right.moderatorName ||
    (left.discord_user_id || "") !== (right.discordUserId || "") ||
    left.starts_at !== right.startsAt ||
    left.ends_at !== right.endsAt ||
    left.notes !== right.notes ||
    left.shift_type !== right.shiftType ||
    left.world !== right.world ||
    left.task !== right.task ||
    Boolean(left.is_lead) !== Boolean(right.isLead) ||
    Boolean(left.requires_clocking) !== Boolean(right.requiresClocking) ||
    (left.updated_at ?? "") !== right.updatedAt
  );
};

const buildShiftSnapshot = (shift) => {
  return {
    discordUserId: shift.discordUserId,
    endsAt: shift.endsAt,
    id: shift.id,
    isLead: Boolean(shift.isLead),
    moderatorName: shift.moderatorName,
    notes: shift.notes,
    requiresClocking: Boolean(shift.requiresClocking),
    shiftType: shift.shiftType,
    sonaraUserId: shift.sonaraUserId,
    startsAt: shift.startsAt,
    task: shift.task,
    teamKey: shift.teamKey,
    userRole: shift.userRole,
    world: shift.world
  };
};

export class BotDatabase {
  constructor(config) {
    this.config = config;
    this.pool = new Pool({
      connectionString: config.databaseUrl
    });

    this.tables = {
      clockSessions: qualify(config.botSchema, "clock_sessions"),
      discordLinkRequests: qualify(config.botSchema, "discord_link_requests"),
      discordLinks: qualify(config.botSchema, "discord_links"),
      incidents: qualify(config.botSchema, "incidents"),
      notificationEvents: qualify(config.botSchema, "notification_events"),
      settings: qualify(config.botSchema, "settings"),
      teamRoutes: qualify(config.botSchema, "team_routes"),
      tickets: qualify(config.botSchema, "tickets"),
      trackedShifts: qualify(config.botSchema, "tracked_shifts"),
      userNotificationPreferences: qualify(config.botSchema, "user_notification_preferences"),
      voiceRooms: qualify(config.botSchema, "voice_rooms"),
      webSessions: qualify(config.botSchema, "web_sessions")
    };

    this.sourceTables = {
      shifts: qualify(config.sonara.schema, config.sonara.shiftTable),
      timeEntries: qualify(config.sonara.schema, config.sonara.timeEntryTable),
      users: qualify(config.sonara.schema, config.sonara.usersTable)
    };

    this.sourceColumns = {
      blocked: config.sonara.blockedColumn ? quoteIdentifier(config.sonara.blockedColumn) : "",
      dateKey: quoteIdentifier(config.sonara.dateKeyColumn),
      discordUserId: quoteIdentifier(config.sonara.discordIdColumn),
      discordName: config.sonara.discordNameColumn
        ? quoteIdentifier(config.sonara.discordNameColumn)
        : "",
      displayName: quoteIdentifier(config.sonara.displayNameColumn),
      login: quoteIdentifier(config.sonara.loginColumn),
      passwordHash: quoteIdentifier(config.sonara.passwordHashColumn),
      role: quoteIdentifier(config.sonara.roleColumn),
      shiftEndTime: quoteIdentifier(config.sonara.shiftEndTimeColumn),
      shiftId: quoteIdentifier(config.sonara.shiftIdColumn),
      shiftIsLead: config.sonara.shiftIsLeadColumn
        ? quoteIdentifier(config.sonara.shiftIsLeadColumn)
        : "",
      shiftMemberId: quoteIdentifier(config.sonara.shiftMemberIdColumn),
      shiftNotes: config.sonara.shiftNotesColumn
        ? quoteIdentifier(config.sonara.shiftNotesColumn)
        : "",
      shiftStartTime: quoteIdentifier(config.sonara.shiftStartTimeColumn),
      shiftTask: config.sonara.shiftTaskColumn
        ? quoteIdentifier(config.sonara.shiftTaskColumn)
        : "",
      shiftType: config.sonara.shiftTypeColumn
        ? quoteIdentifier(config.sonara.shiftTypeColumn)
        : "",
      shiftUpdatedAt: config.sonara.shiftUpdatedAtColumn
        ? quoteIdentifier(config.sonara.shiftUpdatedAtColumn)
        : "",
      shiftWorld: config.sonara.shiftWorldColumn
        ? quoteIdentifier(config.sonara.shiftWorldColumn)
        : "",
      timeEntryCheckIn: quoteIdentifier(config.sonara.timeEntryCheckInColumn),
      timeEntryCheckOut: quoteIdentifier(config.sonara.timeEntryCheckOutColumn),
      timeEntryCreatedAt: config.sonara.timeEntryCreatedAtColumn
        ? quoteIdentifier(config.sonara.timeEntryCreatedAtColumn)
        : "",
      timeEntryId: quoteIdentifier(config.sonara.timeEntryIdColumn),
      timeEntryShiftId: config.sonara.timeEntryShiftIdColumn
        ? quoteIdentifier(config.sonara.timeEntryShiftIdColumn)
        : "",
      timeEntryShiftSnapshot: config.sonara.timeEntryShiftSnapshotColumn
        ? quoteIdentifier(config.sonara.timeEntryShiftSnapshotColumn)
        : "",
      timeEntrySortIndex: config.sonara.timeEntrySortIndexColumn
        ? quoteIdentifier(config.sonara.timeEntrySortIndexColumn)
        : "",
      timeEntryUserId: quoteIdentifier(config.sonara.timeEntryUserIdColumn),
      userId: quoteIdentifier(config.sonara.userIdColumn),
      vrchatName: config.sonara.vrchatNameColumn
        ? quoteIdentifier(config.sonara.vrchatNameColumn)
        : ""
    };
  }

  async initialize() {
    const schema = quoteIdentifier(this.config.botSchema);
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tables.settings} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.teamRoutes} (
        team_key TEXT PRIMARY KEY,
        role_id TEXT NOT NULL DEFAULT '',
        channel_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.userNotificationPreferences} (
        user_id TEXT PRIMARY KEY,
        shift_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.discordLinks} (
        sonara_user_id TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL UNIQUE,
        discord_name TEXT NOT NULL DEFAULT '',
        linked_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.discordLinkRequests} (
        token_hash TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        discord_name TEXT NOT NULL DEFAULT '',
        guild_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        consumed_by_user_id TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.trackedShifts} (
        shift_id TEXT PRIMARY KEY,
        sonara_user_id TEXT NOT NULL DEFAULT '',
        user_role TEXT NOT NULL DEFAULT '',
        team_key TEXT NOT NULL DEFAULT '',
        moderator_name TEXT NOT NULL,
        discord_user_id TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        shift_type TEXT NOT NULL DEFAULT '',
        world TEXT NOT NULL DEFAULT '',
        task TEXT NOT NULL DEFAULT '',
        is_lead BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TEXT NOT NULL,
        requires_clocking BOOLEAN NOT NULL DEFAULT TRUE,
        last_synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.notificationEvents} (
        shift_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (shift_id, event_key)
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.clockSessions} (
        id BIGSERIAL PRIMARY KEY,
        source_time_entry_id TEXT UNIQUE,
        shift_id TEXT NOT NULL,
        sonara_user_id TEXT NOT NULL DEFAULT '',
        discord_user_id TEXT NOT NULL DEFAULT '',
        checked_in_at TEXT NOT NULL,
        checked_out_at TEXT,
        opened_source TEXT NOT NULL,
        closed_source TEXT,
        status TEXT NOT NULL,
        shift_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.incidents} (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        sonara_user_id TEXT NOT NULL DEFAULT '',
        discord_user_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        status TEXT NOT NULL,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.tickets} (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL UNIQUE,
        creator_id TEXT NOT NULL,
        status TEXT NOT NULL,
        claimed_by TEXT,
        created_at TEXT NOT NULL,
        closed_at TEXT,
        closed_by TEXT
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.voiceRooms} (
        channel_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        empty_since TEXT,
        invited_user_ids TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS ${this.tables.webSessions} (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
    `);

    await this.pool.query(`
      ALTER TABLE ${this.tables.trackedShifts}
        ADD COLUMN IF NOT EXISTS user_role TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS shift_type TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS world TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS task TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE ${this.tables.clockSessions}
        ADD COLUMN IF NOT EXISTS source_time_entry_id TEXT,
        ADD COLUMN IF NOT EXISTS shift_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    `);

    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clock_sessions_source_entry
        ON ${this.tables.clockSessions} (source_time_entry_id)
        WHERE source_time_entry_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_links_discord_user_id
        ON ${this.tables.discordLinks} (discord_user_id);

      CREATE INDEX IF NOT EXISTS idx_discord_link_requests_discord_user_id
        ON ${this.tables.discordLinkRequests} (discord_user_id);

      CREATE INDEX IF NOT EXISTS idx_discord_link_requests_expires_at
        ON ${this.tables.discordLinkRequests} (expires_at);

      CREATE INDEX IF NOT EXISTS idx_tracked_shifts_ends_at
        ON ${this.tables.trackedShifts} (ends_at);

      CREATE INDEX IF NOT EXISTS idx_tracked_shifts_sonara_user_id
        ON ${this.tables.trackedShifts} (sonara_user_id);

      CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at
        ON ${this.tables.webSessions} (expires_at);
    `);
  }

  async getAllSettings() {
    const result = await this.pool.query(`SELECT key, value FROM ${this.tables.settings} ORDER BY key`);
    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  }

  async setManySettings(entries) {
    const keys = Object.keys(entries);

    if (keys.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    const updatedAt = asIso();

    try {
      await client.query("BEGIN");

      for (const key of keys) {
        await client.query(
          `
            INSERT INTO ${this.tables.settings} (key, value, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT(key) DO UPDATE SET
              value = EXCLUDED.value,
              updated_at = EXCLUDED.updated_at
          `,
          [key, String(entries[key] ?? ""), updatedAt]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTeamRoutes() {
    const result = await this.pool.query(
      `SELECT team_key, role_id, channel_id FROM ${this.tables.teamRoutes} ORDER BY team_key`
    );
    return result.rows.map((row) => ({
      channelId: row.channel_id,
      roleId: row.role_id,
      teamKey: row.team_key
    }));
  }

  async upsertTeamRoute({ teamKey, roleId, channelId }) {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.teamRoutes} (team_key, role_id, channel_id, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(team_key) DO UPDATE SET
          role_id = EXCLUDED.role_id,
          channel_id = EXCLUDED.channel_id,
          updated_at = EXCLUDED.updated_at
      `,
      [
        String(teamKey ?? "").trim(),
        String(roleId ?? "").trim(),
        String(channelId ?? "").trim(),
        asIso()
      ]
    );
  }

  async deleteTeamRoute(teamKey) {
    await this.pool.query(`DELETE FROM ${this.tables.teamRoutes} WHERE team_key = $1`, [teamKey]);
  }

  async getUserNotificationPreference(userId) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.userNotificationPreferences} WHERE user_id = $1`,
      [String(userId)]
    );
    return result.rows[0] ? this.mapUserNotificationPreferenceRow(result.rows[0]) : null;
  }

  async setUserNotificationPreference({
    userId,
    shiftDmEnabled,
    updatedAt = new Date(),
    updatedBy = ""
  }) {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.userNotificationPreferences} (
          user_id,
          shift_dm_enabled,
          updated_by,
          updated_at
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id) DO UPDATE SET
          shift_dm_enabled = EXCLUDED.shift_dm_enabled,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
      `,
      [String(userId), Boolean(shiftDmEnabled), String(updatedBy ?? ""), asIso(updatedAt)]
    );
  }

  async createDiscordLinkRequest({
    discordName = "",
    discordUserId,
    expiresAt,
    guildId = "",
    source = "discord_slash_command"
  }) {
    const token = randomBytes(24).toString("hex");
    const tokenHash = hashToken(token);
    const createdAt = asIso();
    await this.pool.query(
      `
        INSERT INTO ${this.tables.discordLinkRequests} (
          token_hash,
          discord_user_id,
          discord_name,
          guild_id,
          created_at,
          expires_at,
          consumed_at,
          consumed_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, '')
      `,
      [
        tokenHash,
        String(discordUserId ?? "").trim(),
        String(discordName ?? "").trim(),
        String(guildId ?? "").trim(),
        createdAt,
        asIso(expiresAt)
      ]
    );

    return {
      createdAt,
      discordName: String(discordName ?? "").trim(),
      discordUserId: String(discordUserId ?? "").trim(),
      expiresAt: asIso(expiresAt),
      guildId: String(guildId ?? "").trim(),
      source,
      token
    };
  }

  async getDiscordLinkRequest(token) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.discordLinkRequests} WHERE token_hash = $1 LIMIT 1`,
      [hashToken(token)]
    );
    return result.rows[0] ? this.mapDiscordLinkRequestRow(result.rows[0]) : null;
  }

  async deleteExpiredDiscordLinkRequests(referenceDate = new Date()) {
    await this.pool.query(
      `
        DELETE FROM ${this.tables.discordLinkRequests}
        WHERE expires_at <= $1 OR consumed_at IS NOT NULL
      `,
      [asIso(referenceDate)]
    );
  }

  async listNotificationEventsForShifts(shiftIds = []) {
    const ids = shiftIds.map((id) => String(id ?? "").trim()).filter(Boolean);
    if (ids.length === 0) {
      return [];
    }

    const result = await this.pool.query(
      `
        SELECT shift_id, event_key, sent_at
        FROM ${this.tables.notificationEvents}
        WHERE shift_id = ANY($1::text[])
        ORDER BY sent_at DESC
      `,
      [ids]
    );

    return result.rows.map((row) => ({
      eventKey: row.event_key,
      sentAt: row.sent_at,
      shiftId: row.shift_id
    }));
  }

  async listHubUsers() {
    const result = await this.pool.query(
      this.buildHubUserQuery("TRUE", {
        limit: false,
        orderClause: `
          ORDER BY
            CASE COALESCE(u.${this.sourceColumns.role}::text, '')
              WHEN 'admin' THEN 0
              WHEN 'moderator' THEN 1
              WHEN 'moderation_lead' THEN 2
              WHEN 'planner' THEN 3
              ELSE 4
            END,
            LOWER(
              COALESCE(
                NULLIF(u.${this.sourceColumns.displayName}::text, ''),
                ${this.sourceColumns.vrchatName ? `NULLIF(u.${this.sourceColumns.vrchatName}::text, ''),` : ""}
                NULLIF(u.${this.sourceColumns.login}::text, ''),
                'user'
              )
            ) ASC
        `
      })
    );
    return result.rows.map((row) => this.mapHubUserRow(row));
  }

  async findUserByDiscordUserId(discordUserId) {
    const normalizedDiscordUserId = String(discordUserId ?? "").trim();
    if (!normalizedDiscordUserId) {
      return null;
    }

    const result = await this.pool.query(
      this.buildHubUserQuery(
        `
          COALESCE(u.${this.sourceColumns.discordUserId}::text, '') = $1
          OR COALESCE(dl.discord_user_id, '') = $1
        `
      ),
      [normalizedDiscordUserId]
    );
    return result.rows[0] ? this.mapHubUserRow(result.rows[0]) : null;
  }

  async completeDiscordLink({
    actorUserId,
    discordName = "",
    discordUserId,
    source = "self_link",
    token
  }) {
    const tokenHash = hashToken(token);
    const client = await this.pool.connect();
    const nowIso = asIso();

    try {
      await client.query("BEGIN");

      const requestResult = await client.query(
        `
          SELECT *
          FROM ${this.tables.discordLinkRequests}
          WHERE token_hash = $1
          LIMIT 1
        `,
        [tokenHash]
      );

      const requestRow = requestResult.rows[0];
      if (!requestRow) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "request_not_found" };
      }

      const request = this.mapDiscordLinkRequestRow(requestRow);
      if (request.consumedAt) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "request_consumed" };
      }

      if (Date.parse(request.expiresAt) <= Date.now()) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "request_expired" };
      }

      const sourceConflictResult = await client.query(
        this.buildHubUserQuery(
          `
            COALESCE(u.${this.sourceColumns.discordUserId}::text, '') = $1
            AND u.${this.sourceColumns.userId}::text <> $2
          `
        ),
        [String(discordUserId ?? "").trim(), String(actorUserId)]
      );
      if (sourceConflictResult.rows[0]) {
        await client.query("ROLLBACK");
        return {
          conflictUser: this.mapHubUserRow(sourceConflictResult.rows[0]),
          ok: false,
          reason: "discord_conflict"
        };
      }

      const mirrorConflictResult = await client.query(
        `
          SELECT sonara_user_id
          FROM ${this.tables.discordLinks}
          WHERE discord_user_id = $1 AND sonara_user_id <> $2
          LIMIT 1
        `,
        [String(discordUserId ?? "").trim(), String(actorUserId)]
      );
      if (mirrorConflictResult.rows[0]) {
        const conflictUser = await this.getHubUserById(mirrorConflictResult.rows[0].sonara_user_id);
        await client.query("ROLLBACK");
        return {
          conflictUser,
          ok: false,
          reason: "discord_conflict"
        };
      }

      if (this.sourceColumns.discordName) {
        await client.query(
          `
            UPDATE ${this.sourceTables.users}
            SET
              ${this.sourceColumns.discordUserId} = $1,
              ${this.sourceColumns.discordName} = $2
            WHERE ${this.sourceColumns.userId}::text = $3
          `,
          [
            String(discordUserId ?? "").trim(),
            String(discordName ?? "").trim(),
            String(actorUserId)
          ]
        );
      } else {
        await client.query(
          `
            UPDATE ${this.sourceTables.users}
            SET ${this.sourceColumns.discordUserId} = $1
            WHERE ${this.sourceColumns.userId}::text = $2
          `,
          [String(discordUserId ?? "").trim(), String(actorUserId)]
        );
      }

      await client.query(
        `
          INSERT INTO ${this.tables.discordLinks} (
            sonara_user_id,
            discord_user_id,
            discord_name,
            linked_at,
            last_seen_at,
            source
          ) VALUES ($1, $2, $3, $4, $4, $5)
          ON CONFLICT(sonara_user_id) DO UPDATE SET
            discord_user_id = EXCLUDED.discord_user_id,
            discord_name = EXCLUDED.discord_name,
            last_seen_at = EXCLUDED.last_seen_at,
            source = EXCLUDED.source
        `,
        [
          String(actorUserId),
          String(discordUserId ?? "").trim(),
          String(discordName ?? "").trim(),
          nowIso,
          String(source ?? "self_link")
        ]
      );

      await client.query(
        `
          UPDATE ${this.tables.discordLinkRequests}
          SET consumed_at = $1, consumed_by_user_id = $2
          WHERE token_hash = $3 AND consumed_at IS NULL
        `,
        [nowIso, String(actorUserId), tokenHash]
      );

      await client.query(
        `
          UPDATE ${this.tables.trackedShifts}
          SET discord_user_id = $1
          WHERE sonara_user_id = $2
        `,
        [String(discordUserId ?? "").trim(), String(actorUserId)]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      ok: true,
      user: await this.getHubUserById(actorUserId)
    };
  }

  async unlinkDiscordIdentity({ actorUserId = "", sonaraUserId }) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      if (this.sourceColumns.discordName) {
        await client.query(
          `
            UPDATE ${this.sourceTables.users}
            SET
              ${this.sourceColumns.discordUserId} = '',
              ${this.sourceColumns.discordName} = ''
            WHERE ${this.sourceColumns.userId}::text = $1
          `,
          [String(sonaraUserId)]
        );
      } else {
        await client.query(
          `
            UPDATE ${this.sourceTables.users}
            SET ${this.sourceColumns.discordUserId} = ''
            WHERE ${this.sourceColumns.userId}::text = $1
          `,
          [String(sonaraUserId)]
        );
      }

      await client.query(
        `DELETE FROM ${this.tables.discordLinks} WHERE sonara_user_id = $1`,
        [String(sonaraUserId)]
      );

      await client.query(
        `
          UPDATE ${this.tables.trackedShifts}
          SET discord_user_id = ''
          WHERE sonara_user_id = $1
        `,
        [String(sonaraUserId)]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.getHubUserById(sonaraUserId);
  }

  async getHubUserById(userId) {
    const result = await this.pool.query(this.buildHubUserQuery(`u.${this.sourceColumns.userId}::text = $1`), [
      String(userId)
    ]);
    return result.rows[0] ? this.mapHubUserRow(result.rows[0]) : null;
  }

  async authenticateSonaraUser(login, password) {
    const normalizedLogin = String(login ?? "").trim();

    if (!normalizedLogin) {
      return null;
    }

    const result = await this.pool.query(
      this.buildHubUserQuery(`
        (
          LOWER(u.${this.sourceColumns.login}::text) = LOWER($1)
          ${this.sourceColumns.vrchatName ? `OR LOWER(COALESCE(u.${this.sourceColumns.vrchatName}::text, '')) = LOWER($1)` : ""}
          ${this.sourceColumns.discordName ? `OR LOWER(COALESCE(u.${this.sourceColumns.discordName}::text, '')) = LOWER($1)` : ""}
        )
      `),
      [normalizedLogin]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    if (!verifyScryptPassword(String(password ?? ""), row.password_hash)) {
      return null;
    }

    return this.mapHubUserRow(row);
  }

  async getUpcomingShifts(referenceDate = new Date()) {
    const result = await this.pool.query(
      this.buildTrackedShiftQuery(`ts.ends_at > $1`, `ORDER BY ts.starts_at ASC`),
      [asIso(referenceDate)]
    );
    return result.rows.map((row) => this.mapShiftRow(row));
  }

  async listShiftsForSonaraUser(sonaraUserId, referenceDate = new Date()) {
    const result = await this.pool.query(
      this.buildTrackedShiftQuery(
        `ts.sonara_user_id = $1 AND ts.ends_at > $2`,
        `ORDER BY ts.starts_at ASC`
      ),
      [String(sonaraUserId), asIso(referenceDate)]
    );
    return result.rows.map((row) => this.mapShiftRow(row));
  }

  async getShiftById(shiftId) {
    const result = await this.pool.query(this.buildTrackedShiftQuery(`ts.shift_id = $1`), [shiftId]);
    return result.rows[0] ? this.mapShiftRow(result.rows[0]) : null;
  }

  async syncSourceShifts(referenceDate = new Date()) {
    const shifts = await this.listSourceShifts(referenceDate);
    return this.syncTrackedShifts({
      generatedAt: referenceDate,
      mode: "replace",
      shifts
    });
  }

  async syncImportedShifts({ generatedAt = new Date(), mode = "upsert", shifts = [] }) {
    return this.syncTrackedShifts({
      generatedAt,
      mode,
      shifts: shifts.map((shift) => normalizeImportedShift(shift))
    });
  }

  async hasNotification(shiftId, eventKey) {
    const result = await this.pool.query(
      `
        SELECT sent_at
        FROM ${this.tables.notificationEvents}
        WHERE shift_id = $1 AND event_key = $2
      `,
      [shiftId, eventKey]
    );
    return result.rowCount > 0;
  }

  async markNotification(shiftId, eventKey, sentAt = new Date()) {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.notificationEvents} (shift_id, event_key, sent_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (shift_id, event_key) DO UPDATE SET sent_at = EXCLUDED.sent_at
      `,
      [shiftId, eventKey, asIso(sentAt)]
    );
  }

  async deleteNotificationsForShift(shiftId, client = this.pool) {
    await client.query(`DELETE FROM ${this.tables.notificationEvents} WHERE shift_id = $1`, [shiftId]);
  }

  async getOpenClockSessionForShift(shiftId) {
    const rows = await this.querySourceSessions(
      `
        te.${this.sourceColumns.timeEntryShiftId}::text = $1
        AND te.${this.sourceColumns.timeEntryCheckOut} IS NULL
      `,
      [String(shiftId)],
      `ORDER BY te.${this.sourceColumns.timeEntryCheckIn} DESC LIMIT 1`
    );
    return rows[0] ?? null;
  }

  async getLatestClockSessionForShift(shiftId) {
    const rows = await this.querySourceSessions(
      `te.${this.sourceColumns.timeEntryShiftId}::text = $1`,
      [String(shiftId)],
      `ORDER BY COALESCE(te.${this.sourceColumns.timeEntryCheckOut}, te.${this.sourceColumns.timeEntryCheckIn}) DESC, te.${this.sourceColumns.timeEntryCheckIn} DESC LIMIT 1`
    );
    return rows[0] ?? null;
  }

  async getCurrentOpenSessionForDiscordUser(discordUserId) {
    const rows = await this.querySourceSessions(
      `
        COALESCE(u.${this.sourceColumns.discordUserId}::text, '') = $1
        AND te.${this.sourceColumns.timeEntryCheckOut} IS NULL
      `,
      [String(discordUserId)],
      `ORDER BY te.${this.sourceColumns.timeEntryCheckIn} DESC LIMIT 1`
    );
    return rows[0] ?? null;
  }

  async getCurrentOpenSessionForSonaraUser(sonaraUserId) {
    const rows = await this.querySourceSessions(
      `
        te.${this.sourceColumns.timeEntryUserId}::text = $1
        AND te.${this.sourceColumns.timeEntryCheckOut} IS NULL
      `,
      [String(sonaraUserId)],
      `ORDER BY te.${this.sourceColumns.timeEntryCheckIn} DESC LIMIT 1`
    );
    return rows[0] ?? null;
  }

  async createCheckIn({
    shiftId,
    discordUserId,
    occurredAt = new Date(),
    shiftSnapshot = null,
    sonaraUserId,
    source
  }) {
    const existing = await this.getOpenClockSessionForShift(shiftId);

    if (existing) {
      return existing;
    }

    const occurredAtIso = asIso(occurredAt);
    const sourceTimeEntryId = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const sortIndex = await this.getNextSourceTimeEntrySortIndex(client);
      const shiftSnapshotValue = shiftSnapshot ? buildShiftSnapshot(shiftSnapshot) : null;
      const insertColumns = [
        this.sourceColumns.timeEntryId,
        this.sourceColumns.timeEntryUserId,
        this.sourceColumns.timeEntryCheckIn
      ];
      const placeholders = ["$1", "$2", "$3::timestamptz"];
      const values = [sourceTimeEntryId, String(sonaraUserId ?? ""), occurredAtIso];

      if (this.sourceColumns.timeEntryShiftId) {
        insertColumns.push(this.sourceColumns.timeEntryShiftId);
        placeholders.push(`$${placeholders.length + 1}`);
        values.push(toNullableString(shiftId));
      }

      if (this.sourceColumns.timeEntrySortIndex) {
        insertColumns.push(this.sourceColumns.timeEntrySortIndex);
        placeholders.push(`$${placeholders.length + 1}`);
        values.push(sortIndex);
      }

      if (this.sourceColumns.timeEntryShiftSnapshot) {
        insertColumns.push(this.sourceColumns.timeEntryShiftSnapshot);
        placeholders.push(`$${placeholders.length + 1}::jsonb`);
        values.push(JSON.stringify(shiftSnapshotValue));
      }

      await client.query(
        `
          INSERT INTO ${this.sourceTables.timeEntries} (${insertColumns.join(", ")})
          VALUES (${placeholders.join(", ")})
        `,
        values
      );

      await this.upsertClockMirror(
        {
          checkedInAt: occurredAtIso,
          checkedOutAt: null,
          discordUserId: String(discordUserId ?? ""),
          openedSource: source,
          shiftId,
          shiftSnapshot: shiftSnapshotValue,
          sonaraUserId: String(sonaraUserId ?? ""),
          sourceTimeEntryId,
          status: "open"
        },
        client
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.resolveIncidentByType(shiftId, "no_show", occurredAtIso);
    return this.getOpenClockSessionForShift(shiftId);
  }

  async createCheckOut({ shiftId, occurredAt = new Date(), source }) {
    const existing = await this.getOpenClockSessionForShift(shiftId);

    if (!existing) {
      return null;
    }

    const occurredAtIso = asIso(occurredAt);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
          UPDATE ${this.sourceTables.timeEntries}
          SET ${this.sourceColumns.timeEntryCheckOut} = $1::timestamptz
          WHERE ${this.sourceColumns.timeEntryId}::text = $2
        `,
        [occurredAtIso, existing.sourceTimeEntryId]
      );

      await this.upsertClockMirror(
        {
          ...existing,
          checkedOutAt: occurredAtIso,
          closedSource: source,
          status: "closed"
        },
        client
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.resolveIncidentByType(shiftId, "checkout_missed", occurredAtIso);
    return this.getLatestClockSessionForShift(shiftId);
  }

  async listActiveClockSessions() {
    return this.querySourceSessions(
      `te.${this.sourceColumns.timeEntryCheckOut} IS NULL`,
      [],
      `ORDER BY te.${this.sourceColumns.timeEntryCheckIn} ASC`
    );
  }

  async findOpenIncident(shiftId, type) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.incidents}
        WHERE shift_id = $1 AND type = $2 AND status = 'open'
        LIMIT 1
      `,
      [shiftId, type]
    );
    return result.rows[0] ? this.mapIncidentRow(result.rows[0]) : null;
  }

  async createIncident({
    type,
    shiftId,
    sonaraUserId,
    discordUserId,
    metadata = {},
    createdAt = new Date()
  }) {
    const existing = await this.findOpenIncident(shiftId, type);
    if (existing) {
      return existing;
    }

    const incidentId = randomUUID();
    await this.pool.query(
      `
        INSERT INTO ${this.tables.incidents} (
          id,
          type,
          shift_id,
          sonara_user_id,
          discord_user_id,
          created_at,
          resolved_at,
          status,
          metadata_json
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 'open', $7::jsonb)
      `,
      [
        incidentId,
        type,
        shiftId,
        String(sonaraUserId ?? ""),
        String(discordUserId ?? ""),
        asIso(createdAt),
        JSON.stringify(metadata)
      ]
    );

    return this.findOpenIncident(shiftId, type);
  }

  async resolveIncidentByType(shiftId, type, resolvedAt = new Date()) {
    await this.pool.query(
      `
        UPDATE ${this.tables.incidents}
        SET status = 'resolved', resolved_at = $1
        WHERE shift_id = $2 AND type = $3 AND status = 'open'
      `,
      [asIso(resolvedAt), shiftId, type]
    );
  }

  async listOpenIncidents() {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.incidents}
        WHERE status = 'open'
        ORDER BY created_at ASC
      `
    );
    return result.rows.map((row) => this.mapIncidentRow(row));
  }

  async getOpenTicketByCreator(creatorId) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.tickets}
        WHERE creator_id = $1 AND status = 'open'
        LIMIT 1
      `,
      [creatorId]
    );
    return result.rows[0] ? this.mapTicketRow(result.rows[0]) : null;
  }

  async getTicketByChannel(channelId) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.tickets} WHERE channel_id = $1`,
      [channelId]
    );
    return result.rows[0] ? this.mapTicketRow(result.rows[0]) : null;
  }

  async createTicket({ channelId, creatorId, createdAt = new Date() }) {
    const ticketId = randomUUID();
    await this.pool.query(
      `
        INSERT INTO ${this.tables.tickets} (
          id,
          channel_id,
          creator_id,
          status,
          claimed_by,
          created_at,
          closed_at,
          closed_by
        ) VALUES ($1, $2, $3, 'open', NULL, $4, NULL, NULL)
      `,
      [ticketId, channelId, creatorId, asIso(createdAt)]
    );
    return this.getTicketByChannel(channelId);
  }

  async claimTicket(channelId, claimedBy) {
    await this.pool.query(
      `
        UPDATE ${this.tables.tickets}
        SET claimed_by = $1
        WHERE channel_id = $2 AND status = 'open'
      `,
      [claimedBy, channelId]
    );
    return this.getTicketByChannel(channelId);
  }

  async closeTicket(channelId, closedBy, closedAt = new Date()) {
    await this.pool.query(
      `
        UPDATE ${this.tables.tickets}
        SET status = 'closed', closed_at = $1, closed_by = $2
        WHERE channel_id = $3
      `,
      [asIso(closedAt), closedBy, channelId]
    );
    return this.getTicketByChannel(channelId);
  }

  async listOpenTickets() {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.tickets}
        WHERE status = 'open'
        ORDER BY created_at ASC
      `
    );
    return result.rows.map((row) => this.mapTicketRow(row));
  }

  async createVoiceRoom({ channelId, ownerId, createdAt = new Date() }) {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.voiceRooms} (
          channel_id,
          owner_id,
          created_at,
          empty_since,
          invited_user_ids
        ) VALUES ($1, $2, $3, NULL, '')
        ON CONFLICT(channel_id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          created_at = EXCLUDED.created_at,
          empty_since = NULL,
          invited_user_ids = ''
      `,
      [channelId, ownerId, asIso(createdAt)]
    );
    return this.getVoiceRoom(channelId);
  }

  async getVoiceRoom(channelId) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.voiceRooms} WHERE channel_id = $1`,
      [channelId]
    );
    return result.rows[0] ? this.mapVoiceRoomRow(result.rows[0]) : null;
  }

  async getLatestOwnedVoiceRoom(ownerId) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.voiceRooms}
        WHERE owner_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId]
    );
    return result.rows[0] ? this.mapVoiceRoomRow(result.rows[0]) : null;
  }

  async setVoiceRoomInvites(channelId, invitedUserIds) {
    await this.pool.query(
      `
        UPDATE ${this.tables.voiceRooms}
        SET invited_user_ids = $1
        WHERE channel_id = $2
      `,
      [invitedUserIds.join(","), channelId]
    );
    return this.getVoiceRoom(channelId);
  }

  async markVoiceRoomEmpty(channelId, emptySince = new Date()) {
    await this.pool.query(
      `
        UPDATE ${this.tables.voiceRooms}
        SET empty_since = $1
        WHERE channel_id = $2
      `,
      [asIso(emptySince), channelId]
    );
  }

  async clearVoiceRoomEmpty(channelId) {
    await this.pool.query(
      `
        UPDATE ${this.tables.voiceRooms}
        SET empty_since = NULL
        WHERE channel_id = $1
      `,
      [channelId]
    );
  }

  async listVoiceRooms() {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.voiceRooms} ORDER BY created_at ASC`
    );
    return result.rows.map((row) => this.mapVoiceRoomRow(row));
  }

  async listStaleVoiceRooms(beforeDate) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.voiceRooms}
        WHERE empty_since IS NOT NULL AND empty_since <= $1
      `,
      [asIso(beforeDate)]
    );
    return result.rows.map((row) => this.mapVoiceRoomRow(row));
  }

  async deleteVoiceRoom(channelId) {
    await this.pool.query(`DELETE FROM ${this.tables.voiceRooms} WHERE channel_id = $1`, [channelId]);
  }

  async createWebSession({ sessionId, userId, createdAt = new Date(), expiresAt }) {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.webSessions} (
          session_id,
          user_id,
          created_at,
          expires_at,
          last_seen_at
        ) VALUES ($1, $2, $3, $4, $3)
      `,
      [sessionId, String(userId), asIso(createdAt), asIso(expiresAt)]
    );
  }

  async getWebSession(sessionId) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.webSessions} WHERE session_id = $1`,
      [sessionId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      createdAt: result.rows[0].created_at,
      expiresAt: result.rows[0].expires_at,
      lastSeenAt: result.rows[0].last_seen_at,
      sessionId: result.rows[0].session_id,
      userId: result.rows[0].user_id
    };
  }

  async touchWebSession(sessionId, referenceDate = new Date()) {
    await this.pool.query(
      `
        UPDATE ${this.tables.webSessions}
        SET last_seen_at = $1
        WHERE session_id = $2
      `,
      [asIso(referenceDate), sessionId]
    );
  }

  async deleteWebSession(sessionId) {
    await this.pool.query(`DELETE FROM ${this.tables.webSessions} WHERE session_id = $1`, [sessionId]);
  }

  async deleteExpiredWebSessions(referenceDate = new Date()) {
    await this.pool.query(`DELETE FROM ${this.tables.webSessions} WHERE expires_at <= $1`, [
      asIso(referenceDate)
    ]);
  }

  async getDashboardStats(referenceDate = new Date()) {
    const activeClockQuery = this.sourceColumns.timeEntryShiftId
      ? `
          (
            SELECT COUNT(*)
            FROM ${this.sourceTables.timeEntries} te
            WHERE te.${this.sourceColumns.timeEntryCheckOut} IS NULL
              AND EXISTS (
                SELECT 1
                FROM ${this.tables.trackedShifts} ts
                WHERE ts.shift_id = te.${this.sourceColumns.timeEntryShiftId}::text
              )
          ) AS active_clock_count,
        `
      : `
          (SELECT COUNT(*) FROM ${this.tables.clockSessions} WHERE status = 'open') AS active_clock_count,
        `;

    const result = await this.pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM ${this.tables.trackedShifts} WHERE ends_at > $1) AS upcoming_shift_count,
          (SELECT COUNT(*) FROM ${this.tables.tickets} WHERE status = 'open') AS open_ticket_count,
          ${activeClockQuery}
          (SELECT COUNT(*) FROM ${this.tables.incidents} WHERE status = 'open') AS open_incident_count,
          (SELECT COUNT(*) FROM ${this.tables.voiceRooms}) AS active_voice_room_count
      `,
      [asIso(referenceDate)]
    );

    const row = result.rows[0];
    return {
      activeClockCount: Number(row.active_clock_count ?? 0),
      activeVoiceRoomCount: Number(row.active_voice_room_count ?? 0),
      openIncidentCount: Number(row.open_incident_count ?? 0),
      openTicketCount: Number(row.open_ticket_count ?? 0),
      upcomingShiftCount: Number(row.upcoming_shift_count ?? 0)
    };
  }

  async close() {
    await this.pool.end();
  }

  async listSourceShifts(referenceDate = new Date()) {
    const startWindow = new Date(
      referenceDate.getTime() - this.config.shiftLookbackHours * 60 * 60 * 1000
    );
    const endWindow = new Date(
      referenceDate.getTime() + this.config.shiftLookaheadDays * 24 * 60 * 60 * 1000
    );
    const startDateKey = addDaysToDateKey(parseDateKey(startWindow), -1);
    const endDateKey = addDaysToDateKey(parseDateKey(endWindow), 1);
    const blockedClause = this.sourceColumns.blocked
      ? `AND COALESCE(u.${this.sourceColumns.blocked}, FALSE) = FALSE`
      : "";

    const result = await this.pool.query(
      `
        SELECT
          s.${this.sourceColumns.shiftId}::text AS shift_id,
          s.${this.sourceColumns.shiftMemberId}::text AS sonara_user_id,
          u.${this.sourceColumns.role}::text AS user_role,
          COALESCE(
            NULLIF(u.${this.sourceColumns.displayName}::text, ''),
            ${this.sourceColumns.vrchatName ? `NULLIF(u.${this.sourceColumns.vrchatName}::text, ''),` : ""}
            NULLIF(u.${this.sourceColumns.login}::text, ''),
            'User ' || u.${this.sourceColumns.userId}::text
          ) AS moderator_name,
          COALESCE(NULLIF(u.${this.sourceColumns.discordUserId}::text, ''), dl.discord_user_id, '') AS discord_user_id,
          s.${this.sourceColumns.dateKey} AS date_key,
          s.${this.sourceColumns.shiftStartTime}::text AS start_time,
          s.${this.sourceColumns.shiftEndTime}::text AS end_time,
          ${this.sourceColumns.shiftType ? `COALESCE(s.${this.sourceColumns.shiftType}::text, '')` : "''"} AS shift_type,
          ${this.sourceColumns.shiftWorld ? `COALESCE(s.${this.sourceColumns.shiftWorld}::text, '')` : "''"} AS world,
          ${this.sourceColumns.shiftTask ? `COALESCE(s.${this.sourceColumns.shiftTask}::text, '')` : "''"} AS task,
          ${this.sourceColumns.shiftNotes ? `COALESCE(s.${this.sourceColumns.shiftNotes}::text, '')` : "''"} AS notes,
          ${this.sourceColumns.shiftIsLead ? `COALESCE(s.${this.sourceColumns.shiftIsLead}, FALSE)` : "FALSE"} AS is_lead,
          ${this.sourceColumns.shiftUpdatedAt ? `COALESCE(s.${this.sourceColumns.shiftUpdatedAt}, NOW())` : "NOW()"} AS updated_at
        FROM ${this.sourceTables.shifts} s
        INNER JOIN ${this.sourceTables.users} u
          ON u.${this.sourceColumns.userId} = s.${this.sourceColumns.shiftMemberId}
        LEFT JOIN ${this.tables.discordLinks} dl
          ON dl.sonara_user_id = u.${this.sourceColumns.userId}::text
        WHERE s.${this.sourceColumns.dateKey} BETWEEN $1::date AND $2::date
          ${blockedClause}
        ORDER BY s.${this.sourceColumns.dateKey} ASC, s.${this.sourceColumns.shiftStartTime} ASC
      `,
      [startDateKey, endDateKey]
    );

    return result.rows
      .map((row) => this.buildSourceShift(row))
      .filter((shift) => Date.parse(shift.endsAt) > startWindow.getTime())
      .filter((shift) => Date.parse(shift.startsAt) < endWindow.getTime())
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  }

  async syncTrackedShifts({ generatedAt = new Date(), mode = "upsert", shifts = [] }) {
    const nowIso = asIso(generatedAt);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const oldRowsResult = await client.query(
        `
          SELECT *
          FROM ${this.tables.trackedShifts}
          WHERE ends_at > $1
          ORDER BY starts_at ASC
        `,
        [nowIso]
      );

      const oldRows = oldRowsResult.rows;
      const oldMap = new Map(oldRows.map((row) => [row.shift_id, row]));
      const sonaraUserIds = [
        ...new Set(shifts.map((shift) => String(shift.sonaraUserId ?? "").trim()).filter(Boolean))
      ];
      const linkMap = new Map();
      if (sonaraUserIds.length > 0) {
        const linkResult = await client.query(
          `
            SELECT sonara_user_id, discord_user_id
            FROM ${this.tables.discordLinks}
            WHERE sonara_user_id = ANY($1::text[])
          `,
          [sonaraUserIds]
        );
        for (const row of linkResult.rows) {
          linkMap.set(row.sonara_user_id, row.discord_user_id);
        }
      }
      const changes = { created: [], removed: [], updated: [] };
      const savedShifts = [];
      const seenIds = new Set();

      for (const shift of shifts) {
        seenIds.add(shift.id);
        const previous = oldMap.get(shift.id);
        const savedShift = {
          ...shift,
          discordUserId:
            shift.discordUserId ||
            linkMap.get(String(shift.sonaraUserId ?? "").trim()) ||
            previous?.discord_user_id ||
            ""
        };
        savedShifts.push(savedShift);

        if (!previous) {
          changes.created.push(savedShift);
        } else if (shiftChanged(previous, savedShift)) {
          changes.updated.push({
            current: savedShift,
            previous: this.mapShiftRow(previous)
          });
          await this.deleteNotificationsForShift(shift.id, client);
        }

        await client.query(
          `
            INSERT INTO ${this.tables.trackedShifts} (
            shift_id,
              sonara_user_id,
              user_role,
              team_key,
              moderator_name,
              discord_user_id,
              starts_at,
              ends_at,
              notes,
              shift_type,
              world,
              task,
              is_lead,
              updated_at,
              requires_clocking,
              last_synced_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT(shift_id) DO UPDATE SET
              sonara_user_id = EXCLUDED.sonara_user_id,
              user_role = EXCLUDED.user_role,
              team_key = EXCLUDED.team_key,
              moderator_name = EXCLUDED.moderator_name,
              discord_user_id = EXCLUDED.discord_user_id,
              starts_at = EXCLUDED.starts_at,
              ends_at = EXCLUDED.ends_at,
              notes = EXCLUDED.notes,
              shift_type = EXCLUDED.shift_type,
              world = EXCLUDED.world,
              task = EXCLUDED.task,
              is_lead = EXCLUDED.is_lead,
              updated_at = EXCLUDED.updated_at,
              requires_clocking = EXCLUDED.requires_clocking,
              last_synced_at = EXCLUDED.last_synced_at
          `,
          [
            savedShift.id,
            savedShift.sonaraUserId,
            savedShift.userRole,
            savedShift.teamKey,
            savedShift.moderatorName,
            savedShift.discordUserId,
            savedShift.startsAt,
            savedShift.endsAt,
            savedShift.notes,
            savedShift.shiftType,
            savedShift.world,
            savedShift.task,
            Boolean(savedShift.isLead),
            savedShift.updatedAt,
            Boolean(savedShift.requiresClocking),
            nowIso
          ]
        );
      }

      if (mode === "replace") {
        for (const row of oldRows) {
          if (seenIds.has(row.shift_id)) {
            continue;
          }

          changes.removed.push(this.mapShiftRow(row));
          await client.query(`DELETE FROM ${this.tables.trackedShifts} WHERE shift_id = $1`, [
            row.shift_id
          ]);
          await this.deleteNotificationsForShift(row.shift_id, client);
        }
      }

      await client.query("COMMIT");
      await this.setManySettings({ lastSourceSyncAt: nowIso });

      return {
        changes,
        saved: savedShifts
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  buildHubUserQuery(whereClause, { limit = true, orderClause = "" } = {}) {
    const blockedClause = this.sourceColumns.blocked
      ? `AND COALESCE(u.${this.sourceColumns.blocked}, FALSE) = FALSE`
      : "";

    return `
      SELECT
        u.${this.sourceColumns.userId}::text AS user_id,
        u.${this.sourceColumns.login}::text AS login_name,
        COALESCE(
          NULLIF(u.${this.sourceColumns.displayName}::text, ''),
          ${this.sourceColumns.vrchatName ? `NULLIF(u.${this.sourceColumns.vrchatName}::text, ''),` : ""}
          NULLIF(u.${this.sourceColumns.login}::text, ''),
          'User ' || u.${this.sourceColumns.userId}::text
        ) AS display_name,
        COALESCE(u.${this.sourceColumns.passwordHash}::text, '') AS password_hash,
        COALESCE(u.${this.sourceColumns.discordUserId}::text, '') AS source_discord_user_id,
        ${this.sourceColumns.discordName ? `COALESCE(u.${this.sourceColumns.discordName}::text, '')` : "''"} AS source_discord_name,
        COALESCE(dl.discord_user_id, '') AS linked_discord_user_id,
        COALESCE(dl.discord_name, '') AS linked_discord_name,
        pref.shift_dm_enabled AS shift_dm_enabled_override,
        COALESCE(u.${this.sourceColumns.role}::text, '') AS user_role
      FROM ${this.sourceTables.users} u
      LEFT JOIN ${this.tables.userNotificationPreferences} pref
        ON pref.user_id = u.${this.sourceColumns.userId}::text
      LEFT JOIN ${this.tables.discordLinks} dl
        ON dl.sonara_user_id = u.${this.sourceColumns.userId}::text
      WHERE ${whereClause}
      ${blockedClause}
      ${orderClause}
      ${limit ? "LIMIT 1" : ""}
    `;
  }

  buildTrackedShiftQuery(whereClause, orderClause = "") {
    return `
      SELECT
        ts.*,
        COALESCE(NULLIF(su.${this.sourceColumns.discordUserId}::text, ''), ts.discord_user_id, '') AS effective_discord_user_id,
        COALESCE(NULLIF(su.${this.sourceColumns.role}::text, ''), ts.user_role, '') AS effective_user_role,
        pref.shift_dm_enabled AS shift_dm_enabled_override
      FROM ${this.tables.trackedShifts} ts
      LEFT JOIN ${this.sourceTables.users} su
        ON su.${this.sourceColumns.userId}::text = ts.sonara_user_id
      LEFT JOIN ${this.tables.userNotificationPreferences} pref
        ON pref.user_id = ts.sonara_user_id
      WHERE ${whereClause}
      ${orderClause}
    `;
  }

  buildSourceShift(row) {
    const userRole = String(row.user_role ?? "").trim().toLowerCase();
    const dateKey = parseDateKey(row.date_key);
    const startTimeText = String(row.start_time ?? "").trim();
    const endTimeText = String(row.end_time ?? "").trim();
    const endsNextDay = timeToComparable(endTimeText) <= timeToComparable(startTimeText);
    const endDateKey = endsNextDay ? addDaysToDateKey(dateKey, 1) : dateKey;
    const startsAt = zonedDateTimeToIso({
      dateKey,
      timeText: startTimeText,
      timeZone: this.config.timezone
    });
    const endsAt = zonedDateTimeToIso({
      dateKey: endDateKey,
      timeText: endTimeText,
      timeZone: this.config.timezone
    });

    return {
      discordUserId: String(row.discord_user_id ?? "").trim(),
      endsAt,
      id: String(row.shift_id ?? "").trim(),
      isLead: Boolean(row.is_lead),
      moderatorName: String(row.moderator_name ?? "").trim(),
      notes: String(row.notes ?? "").trim(),
      requiresClocking: true,
      shiftType: String(row.shift_type ?? "").trim(),
      sonaraUserId: String(row.sonara_user_id ?? "").trim(),
      startsAt,
      task: String(row.task ?? "").trim(),
      teamKey: userRole,
      updatedAt: row.updated_at ? asIso(row.updated_at) : startsAt,
      userRole,
      world: String(row.world ?? "").trim()
    };
  }

  async querySourceSessions(whereClause, params = [], orderClause = "") {
    const result = await this.pool.query(
      `
        SELECT
          te.${this.sourceColumns.timeEntryId}::text AS source_time_entry_id,
          ${this.sourceColumns.timeEntryShiftId ? `COALESCE(te.${this.sourceColumns.timeEntryShiftId}::text, '')` : "''"} AS shift_id,
          te.${this.sourceColumns.timeEntryUserId}::text AS sonara_user_id,
          COALESCE(u.${this.sourceColumns.discordUserId}::text, '') AS discord_user_id,
          te.${this.sourceColumns.timeEntryCheckIn} AS checked_in_at,
          te.${this.sourceColumns.timeEntryCheckOut} AS checked_out_at,
          ${this.sourceColumns.timeEntryShiftSnapshot ? `te.${this.sourceColumns.timeEntryShiftSnapshot}` : "NULL"} AS shift_snapshot_json,
          ${this.sourceColumns.timeEntryCreatedAt ? `te.${this.sourceColumns.timeEntryCreatedAt}` : `te.${this.sourceColumns.timeEntryCheckIn}`} AS source_created_at,
          cs.opened_source,
          cs.closed_source
        FROM ${this.sourceTables.timeEntries} te
        INNER JOIN ${this.sourceTables.users} u
          ON u.${this.sourceColumns.userId} = te.${this.sourceColumns.timeEntryUserId}
        LEFT JOIN ${this.tables.clockSessions} cs
          ON cs.source_time_entry_id = te.${this.sourceColumns.timeEntryId}::text
        WHERE ${whereClause}
        ${orderClause}
      `,
      params
    );

    const sessions = [];

    for (const row of result.rows) {
      const session = this.mapSourceSessionRow(row);
      await this.upsertClockMirror(session);
      sessions.push(session);
    }

    return sessions;
  }

  async getNextSourceTimeEntrySortIndex(client = this.pool) {
    if (!this.sourceColumns.timeEntrySortIndex) {
      return 0;
    }

    const result = await client.query(
      `
        SELECT COALESCE(MAX(${this.sourceColumns.timeEntrySortIndex}), -1) + 1 AS next_sort_index
        FROM ${this.sourceTables.timeEntries}
      `
    );

    return Number(result.rows[0]?.next_sort_index ?? 0);
  }

  async upsertClockMirror(session, client = this.pool) {
    await client.query(
      `
        INSERT INTO ${this.tables.clockSessions} (
          source_time_entry_id,
          shift_id,
          sonara_user_id,
          discord_user_id,
          checked_in_at,
          checked_out_at,
          opened_source,
          closed_source,
          status,
          shift_snapshot_json,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT(source_time_entry_id) DO UPDATE SET
          shift_id = EXCLUDED.shift_id,
          sonara_user_id = EXCLUDED.sonara_user_id,
          discord_user_id = EXCLUDED.discord_user_id,
          checked_in_at = EXCLUDED.checked_in_at,
          checked_out_at = EXCLUDED.checked_out_at,
          opened_source = COALESCE(NULLIF(opened_source, ''), EXCLUDED.opened_source),
          closed_source = COALESCE(EXCLUDED.closed_source, closed_source),
          status = EXCLUDED.status,
          shift_snapshot_json = CASE
            WHEN EXCLUDED.shift_snapshot_json = '{}'::jsonb THEN shift_snapshot_json
            ELSE EXCLUDED.shift_snapshot_json
          END,
          created_at = CASE
            WHEN created_at = '' THEN EXCLUDED.created_at
            ELSE created_at
          END,
          updated_at = EXCLUDED.updated_at
      `,
      [
        session.sourceTimeEntryId ?? null,
        session.shiftId ?? "",
        session.sonaraUserId ?? "",
        session.discordUserId ?? "",
        session.checkedInAt ?? "",
        session.checkedOutAt ?? null,
        session.openedSource ?? "sonara",
        session.closedSource ?? null,
        session.status ?? (session.checkedOutAt ? "closed" : "open"),
        JSON.stringify(session.shiftSnapshot ?? {}),
        session.createdAt ?? session.checkedInAt ?? asIso(),
        asIso()
      ]
    );
  }

  mapHubUserRow(row) {
    const role = String(row.user_role ?? "").trim();
    const flags = toRoleFlags(role);
    const shiftDmEnabledOverride =
      row.shift_dm_enabled_override === null || row.shift_dm_enabled_override === undefined
        ? null
        : Boolean(row.shift_dm_enabled_override);
    const sourceDiscordUserId = String(row.source_discord_user_id ?? "").trim();
    const sourceDiscordName = String(row.source_discord_name ?? "").trim();
    const linkedDiscordUserId = String(row.linked_discord_user_id ?? "").trim();
    const linkedDiscordName = String(row.linked_discord_name ?? "").trim();
    const discordUserId = sourceDiscordUserId || linkedDiscordUserId;
    const discordName = sourceDiscordName || linkedDiscordName;
    const shiftDmEnabled =
      shiftDmEnabledOverride === null ? getDefaultShiftDmEnabled(role) : shiftDmEnabledOverride;

    return {
      canAccessHub: flags.canAccessHub,
      discordName,
      discordUserId,
      displayName: row.display_name,
      hasDiscordLink: Boolean(discordUserId),
      hasDiscordSyncMismatch:
        Boolean(sourceDiscordUserId) && Boolean(linkedDiscordUserId) && sourceDiscordUserId !== linkedDiscordUserId,
      id: row.user_id,
      isAdmin: flags.isAdmin,
      isHead: flags.isHead,
      isModerator: flags.isModerator,
      linkedDiscordName,
      linkedDiscordUserId,
      loginName: row.login_name,
      role,
      roleKeys: role ? [role] : [],
      roleNames: role ? [humanizeRole(role)] : [],
      shiftDmEnabled,
      shiftDmEnabledOverride,
      shiftDmStateLabel: shiftDmEnabled ? "aktiv" : "deaktiviert",
      shouldReceiveShiftDm: shiftDmEnabled && Boolean(discordUserId),
      sourceDiscordName,
      sourceDiscordUserId
    };
  }

  mapShiftRow(row) {
    const userRole = String(row.effective_user_role ?? row.user_role ?? "").trim().toLowerCase();
    const shiftDmEnabledOverride =
      row.shift_dm_enabled_override === null || row.shift_dm_enabled_override === undefined
        ? null
        : Boolean(row.shift_dm_enabled_override);
    const shiftDmEnabled =
      shiftDmEnabledOverride === null ? getDefaultShiftDmEnabled(userRole) : shiftDmEnabledOverride;
    const discordUserId = String(row.effective_discord_user_id ?? row.discord_user_id ?? "").trim();

    return {
      discordUserId,
      endsAt: row.ends_at,
      id: row.shift_id,
      isLead: Boolean(row.is_lead),
      isReminderAudience: shiftDmEnabled,
      moderatorName: row.moderator_name,
      notes: row.notes,
      requiresClocking: Boolean(row.requires_clocking),
      shiftType: row.shift_type ?? "",
      shouldSendDm: shiftDmEnabled && Boolean(discordUserId),
      sonaraUserId: row.sonara_user_id,
      startsAt: row.starts_at,
      task: row.task ?? "",
      teamKey: row.team_key,
      shiftDmEnabled,
      updatedAt: row.updated_at,
      userRole,
      world: row.world ?? ""
    };
  }

  mapSourceSessionRow(row) {
    return {
      checkedInAt: asIso(row.checked_in_at),
      checkedOutAt: row.checked_out_at ? asIso(row.checked_out_at) : null,
      closedSource: row.closed_source ?? null,
      createdAt: row.source_created_at ? asIso(row.source_created_at) : asIso(row.checked_in_at),
      discordUserId: row.discord_user_id ?? "",
      openedSource: row.opened_source ?? "sonara",
      shiftId: row.shift_id ?? "",
      shiftSnapshot: row.shift_snapshot_json ?? null,
      sonaraUserId: row.sonara_user_id ?? "",
      sourceTimeEntryId: row.source_time_entry_id,
      status: row.checked_out_at ? "closed" : "open"
    };
  }

  mapIncidentRow(row) {
    return {
      createdAt: row.created_at,
      discordUserId: row.discord_user_id,
      id: row.id,
      metadata: row.metadata_json ?? {},
      resolvedAt: row.resolved_at,
      shiftId: row.shift_id,
      sonaraUserId: row.sonara_user_id,
      status: row.status,
      type: row.type
    };
  }

  mapTicketRow(row) {
    return {
      channelId: row.channel_id,
      claimedBy: row.claimed_by,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      createdAt: row.created_at,
      creatorId: row.creator_id,
      id: row.id,
      status: row.status
    };
  }

  mapVoiceRoomRow(row) {
    return {
      channelId: row.channel_id,
      createdAt: row.created_at,
      emptySince: row.empty_since,
      invitedUserIds: row.invited_user_ids ? row.invited_user_ids.split(",").filter(Boolean) : [],
      ownerId: row.owner_id
    };
  }

  mapUserNotificationPreferenceRow(row) {
    return {
      shiftDmEnabled: Boolean(row.shift_dm_enabled),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      userId: row.user_id
    };
  }

  mapDiscordLinkRequestRow(row) {
    return {
      consumedAt: row.consumed_at,
      consumedByUserId: row.consumed_by_user_id,
      createdAt: row.created_at,
      discordName: row.discord_name,
      discordUserId: row.discord_user_id,
      expiresAt: row.expires_at,
      guildId: row.guild_id,
      tokenHash: row.token_hash
    };
  }
}
