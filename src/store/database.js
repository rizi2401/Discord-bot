import { randomUUID } from "node:crypto";
import { compare as compareBcrypt } from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

const asIso = (value = new Date()) => {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const quoteIdentifier = (identifier) => {
  return `"${String(identifier).replaceAll('"', '""')}"`;
};

const qualify = (schema, table) => {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
};

const escapeLike = (value) => {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
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

  return {
    discordUserId: String(shift.discordUserId ?? "").trim(),
    endsAt: asIso(endsAt),
    id,
    moderatorName,
    notes: String(shift.notes ?? "").trim(),
    requiresClocking: shift.requiresClocking === false ? false : true,
    sonaraUserId: String(shift.sonaraUserId ?? "").trim(),
    startsAt: asIso(startsAt),
    teamKey: String(shift.teamKey ?? "").trim(),
    updatedAt: shift.updatedAt ? asIso(shift.updatedAt) : asIso()
  };
};

const shiftChanged = (left, right) => {
  return (
    left.sonara_user_id !== right.sonaraUserId ||
    left.team_key !== right.teamKey ||
    left.moderator_name !== right.moderatorName ||
    left.discord_user_id !== right.discordUserId ||
    left.starts_at !== right.startsAt ||
    left.ends_at !== right.endsAt ||
    left.notes !== right.notes ||
    Boolean(left.requires_clocking) !== Boolean(right.requiresClocking) ||
    (left.updated_at ?? "") !== right.updatedAt
  );
};

const toNullableString = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
};

const toRoleFlags = (roleKeys, config) => {
  const set = new Set(roleKeys);
  const isAdmin = config.sonara.adminRoleKeys.some((key) => set.has(key));
  const isHead = config.sonara.headRoleKeys.some((key) => set.has(key));
  const isModerator =
    isAdmin || isHead || config.sonara.moderatorRoleKeys.some((key) => set.has(key));

  return {
    canAccessHub: isAdmin || isModerator,
    isAdmin,
    isHead,
    isModerator
  };
};

const verifyPassword = async ({ hash, mode, password }) => {
  if (!hash) {
    return false;
  }

  if (mode === "plain") {
    return password === hash;
  }

  if (mode === "bcrypt") {
    return compareBcrypt(password, hash);
  }

  if (hash.startsWith("$2")) {
    return compareBcrypt(password, hash);
  }

  return password === hash;
};

export class BotDatabase {
  constructor(config) {
    this.config = config;
    this.pool = new Pool({
      connectionString: config.databaseUrl
    });
    this.tables = {
      settings: qualify(config.botSchema, "settings"),
      teamRoutes: qualify(config.botSchema, "team_routes"),
      trackedShifts: qualify(config.botSchema, "tracked_shifts"),
      notificationEvents: qualify(config.botSchema, "notification_events"),
      clockSessions: qualify(config.botSchema, "clock_sessions"),
      incidents: qualify(config.botSchema, "incidents"),
      tickets: qualify(config.botSchema, "tickets"),
      voiceRooms: qualify(config.botSchema, "voice_rooms"),
      webSessions: qualify(config.botSchema, "web_sessions")
    };
    this.sourceTables = {
      roles: qualify(config.sonara.schema, config.sonara.rolesTable),
      shifts: qualify(config.sonara.schema, config.sonara.shiftTable),
      userRoles: qualify(config.sonara.schema, config.sonara.userRolesTable),
      users: qualify(config.sonara.schema, config.sonara.usersTable)
    };
    this.sourceColumns = {
      active: config.sonara.userActiveColumn
        ? quoteIdentifier(config.sonara.userActiveColumn)
        : "",
      discordUserId: quoteIdentifier(config.sonara.discordIdColumn),
      displayName: quoteIdentifier(config.sonara.displayNameColumn),
      login: quoteIdentifier(config.sonara.loginColumn),
      passwordHash: quoteIdentifier(config.sonara.passwordHashColumn),
      roleKey: quoteIdentifier(config.sonara.roleKeyColumn),
      roleName: quoteIdentifier(config.sonara.roleNameColumn),
      shiftClocking: quoteIdentifier(config.sonara.shiftClockingColumn),
      shiftEnd: quoteIdentifier(config.sonara.shiftEndColumn),
      shiftNotes: quoteIdentifier(config.sonara.shiftNotesColumn),
      shiftStart: quoteIdentifier(config.sonara.shiftStartColumn),
      shiftStatus: config.sonara.shiftStatusColumn
        ? quoteIdentifier(config.sonara.shiftStatusColumn)
        : "",
      shiftTableId: quoteIdentifier("id"),
      shiftTeamKey: quoteIdentifier(config.sonara.shiftTeamKeyColumn),
      shiftUpdatedAt: quoteIdentifier(config.sonara.shiftUpdatedAtColumn),
      shiftUserId: quoteIdentifier(config.sonara.shiftUserIdColumn),
      userId: quoteIdentifier("id")
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

      CREATE TABLE IF NOT EXISTS ${this.tables.trackedShifts} (
        shift_id TEXT PRIMARY KEY,
        sonara_user_id TEXT NOT NULL DEFAULT '',
        team_key TEXT NOT NULL DEFAULT '',
        moderator_name TEXT NOT NULL,
        discord_user_id TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
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
        shift_id TEXT NOT NULL,
        sonara_user_id TEXT NOT NULL DEFAULT '',
        discord_user_id TEXT NOT NULL DEFAULT '',
        checked_in_at TEXT NOT NULL,
        checked_out_at TEXT,
        opened_source TEXT NOT NULL,
        closed_source TEXT,
        status TEXT NOT NULL
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
    await this.pool.query(`DELETE FROM ${this.tables.teamRoutes} WHERE team_key = $1`, [
      teamKey
    ]);
  }

  async getHubUserById(userId) {
    const result = await this.pool.query(this.buildHubUserQuery("u.id::text = $1"), [String(userId)]);
    return result.rows[0] ? this.mapHubUserRow(result.rows[0]) : null;
  }

  async authenticateSonaraUser(login, password) {
    const result = await this.pool.query(
      this.buildHubUserQuery(`LOWER(u.${this.sourceColumns.login}::text) = LOWER($1)`),
      [String(login ?? "").trim()]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const passwordMatches = await verifyPassword({
      hash: row.password_hash,
      mode: this.config.sonara.passwordMode,
      password: String(password ?? "")
    });

    if (!passwordMatches) {
      return null;
    }

    return this.mapHubUserRow(row);
  }

  async getUpcomingShifts(referenceDate = new Date()) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.trackedShifts}
        WHERE ends_at > $1
        ORDER BY starts_at ASC
      `,
      [asIso(referenceDate)]
    );
    return result.rows.map((row) => this.mapShiftRow(row));
  }

  async listShiftsForSonaraUser(sonaraUserId, referenceDate = new Date()) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.trackedShifts}
        WHERE sonara_user_id = $1 AND ends_at > $2
        ORDER BY starts_at ASC
      `,
      [String(sonaraUserId), asIso(referenceDate)]
    );
    return result.rows.map((row) => this.mapShiftRow(row));
  }

  async getShiftById(shiftId) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tables.trackedShifts} WHERE shift_id = $1`,
      [shiftId]
    );
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
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.clockSessions}
        WHERE shift_id = $1 AND status = 'open'
        ORDER BY id DESC
        LIMIT 1
      `,
      [shiftId]
    );
    return result.rows[0] ? this.mapClockSessionRow(result.rows[0]) : null;
  }

  async getLatestClockSessionForShift(shiftId) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.clockSessions}
        WHERE shift_id = $1
        ORDER BY id DESC
        LIMIT 1
      `,
      [shiftId]
    );
    return result.rows[0] ? this.mapClockSessionRow(result.rows[0]) : null;
  }

  async getCurrentOpenSessionForDiscordUser(discordUserId) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.clockSessions}
        WHERE discord_user_id = $1 AND status = 'open'
        ORDER BY checked_in_at DESC
        LIMIT 1
      `,
      [String(discordUserId)]
    );
    return result.rows[0] ? this.mapClockSessionRow(result.rows[0]) : null;
  }

  async getCurrentOpenSessionForSonaraUser(sonaraUserId) {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.clockSessions}
        WHERE sonara_user_id = $1 AND status = 'open'
        ORDER BY checked_in_at DESC
        LIMIT 1
      `,
      [String(sonaraUserId)]
    );
    return result.rows[0] ? this.mapClockSessionRow(result.rows[0]) : null;
  }

  async createCheckIn({ shiftId, discordUserId, occurredAt = new Date(), sonaraUserId, source }) {
    const existing = await this.getOpenClockSessionForShift(shiftId);

    if (existing) {
      return existing;
    }

    await this.pool.query(
      `
        INSERT INTO ${this.tables.clockSessions} (
          shift_id,
          sonara_user_id,
          discord_user_id,
          checked_in_at,
          checked_out_at,
          opened_source,
          closed_source,
          status
        ) VALUES ($1, $2, $3, $4, NULL, $5, NULL, 'open')
      `,
      [
        shiftId,
        String(sonaraUserId ?? ""),
        String(discordUserId ?? ""),
        asIso(occurredAt),
        source
      ]
    );

    await this.resolveIncidentByType(shiftId, "no_show", occurredAt);
    return this.getOpenClockSessionForShift(shiftId);
  }

  async createCheckOut({ shiftId, occurredAt = new Date(), source }) {
    const existing = await this.getOpenClockSessionForShift(shiftId);

    if (!existing) {
      return null;
    }

    await this.pool.query(
      `
        UPDATE ${this.tables.clockSessions}
        SET checked_out_at = $1, closed_source = $2, status = 'closed'
        WHERE id = $3
      `,
      [asIso(occurredAt), source, existing.id]
    );

    await this.resolveIncidentByType(shiftId, "checkout_missed", occurredAt);
    return this.getLatestClockSessionForShift(shiftId);
  }

  async listActiveClockSessions() {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.clockSessions}
        WHERE status = 'open'
        ORDER BY checked_in_at ASC
      `
    );
    return result.rows.map((row) => this.mapClockSessionRow(row));
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
    await this.pool.query(`DELETE FROM ${this.tables.voiceRooms} WHERE channel_id = $1`, [
      channelId
    ]);
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
    await this.pool.query(`DELETE FROM ${this.tables.webSessions} WHERE session_id = $1`, [
      sessionId
    ]);
  }

  async deleteExpiredWebSessions(referenceDate = new Date()) {
    await this.pool.query(
      `DELETE FROM ${this.tables.webSessions} WHERE expires_at <= $1`,
      [asIso(referenceDate)]
    );
  }

  async getDashboardStats(referenceDate = new Date()) {
    const result = await this.pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM ${this.tables.trackedShifts} WHERE ends_at > $1) AS upcoming_shift_count,
          (SELECT COUNT(*) FROM ${this.tables.tickets} WHERE status = 'open') AS open_ticket_count,
          (SELECT COUNT(*) FROM ${this.tables.clockSessions} WHERE status = 'open') AS active_clock_count,
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

    const statusClause = this.sourceColumns.shiftStatus
      ? `AND s.${this.sourceColumns.shiftStatus}::text = ANY($3::text[])`
      : "";
    const activeClause = this.sourceColumns.active
      ? `AND COALESCE(u.${this.sourceColumns.active}, TRUE) = TRUE`
      : "";

    const params = [
      asIso(startWindow),
      asIso(endWindow)
    ];

    if (this.sourceColumns.shiftStatus) {
      params.push(this.config.sonara.shiftActiveStatuses);
    }

    const result = await this.pool.query(
      `
        SELECT
          s.${this.sourceColumns.shiftTableId}::text AS shift_id,
          s.${this.sourceColumns.shiftUserId}::text AS sonara_user_id,
          COALESCE(s.${this.sourceColumns.shiftTeamKey}::text, '') AS team_key,
          COALESCE(
            NULLIF(u.${this.sourceColumns.displayName}::text, ''),
            NULLIF(u.${this.sourceColumns.login}::text, ''),
            'User ' || u.${this.sourceColumns.userId}::text
          ) AS moderator_name,
          COALESCE(u.${this.sourceColumns.discordUserId}::text, '') AS discord_user_id,
          s.${this.sourceColumns.shiftStart} AS starts_at,
          s.${this.sourceColumns.shiftEnd} AS ends_at,
          COALESCE(s.${this.sourceColumns.shiftNotes}::text, '') AS notes,
          COALESCE(s.${this.sourceColumns.shiftUpdatedAt}, s.${this.sourceColumns.shiftStart}) AS updated_at,
          COALESCE(s.${this.sourceColumns.shiftClocking}, TRUE) AS requires_clocking
        FROM ${this.sourceTables.shifts} s
        INNER JOIN ${this.sourceTables.users} u
          ON u.${this.sourceColumns.userId} = s.${this.sourceColumns.shiftUserId}
        WHERE s.${this.sourceColumns.shiftEnd} > $1::timestamptz
          AND s.${this.sourceColumns.shiftStart} < $2::timestamptz
          ${statusClause}
          ${activeClause}
        ORDER BY s.${this.sourceColumns.shiftStart} ASC
      `,
      params
    );

    return result.rows.map((row) => ({
      discordUserId: row.discord_user_id,
      endsAt: asIso(row.ends_at),
      id: row.shift_id,
      moderatorName: row.moderator_name,
      notes: row.notes,
      requiresClocking: Boolean(row.requires_clocking),
      sonaraUserId: row.sonara_user_id,
      startsAt: asIso(row.starts_at),
      teamKey: row.team_key,
      updatedAt: asIso(row.updated_at)
    }));
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
      const changes = { created: [], removed: [], updated: [] };
      const seenIds = new Set();

      for (const shift of shifts) {
        seenIds.add(shift.id);
        const previous = oldMap.get(shift.id);

        if (!previous) {
          changes.created.push(shift);
        } else if (shiftChanged(previous, shift)) {
          changes.updated.push({
            current: shift,
            previous: this.mapShiftRow(previous)
          });
          await this.deleteNotificationsForShift(shift.id, client);
        }

        await client.query(
          `
            INSERT INTO ${this.tables.trackedShifts} (
              shift_id,
              sonara_user_id,
              team_key,
              moderator_name,
              discord_user_id,
              starts_at,
              ends_at,
              notes,
              updated_at,
              requires_clocking,
              last_synced_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT(shift_id) DO UPDATE SET
              sonara_user_id = EXCLUDED.sonara_user_id,
              team_key = EXCLUDED.team_key,
              moderator_name = EXCLUDED.moderator_name,
              discord_user_id = EXCLUDED.discord_user_id,
              starts_at = EXCLUDED.starts_at,
              ends_at = EXCLUDED.ends_at,
              notes = EXCLUDED.notes,
              updated_at = EXCLUDED.updated_at,
              requires_clocking = EXCLUDED.requires_clocking,
              last_synced_at = EXCLUDED.last_synced_at
          `,
          [
            shift.id,
            shift.sonaraUserId,
            shift.teamKey,
            shift.moderatorName,
            shift.discordUserId,
            shift.startsAt,
            shift.endsAt,
            shift.notes,
            shift.updatedAt,
            Boolean(shift.requiresClocking),
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
        saved: shifts
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  buildHubUserQuery(whereClause) {
    const activeClause = this.sourceColumns.active
      ? `AND COALESCE(u.${this.sourceColumns.active}, TRUE) = TRUE`
      : "";

    return `
      SELECT
        u.${this.sourceColumns.userId}::text AS user_id,
        u.${this.sourceColumns.login}::text AS login_name,
        COALESCE(
          NULLIF(u.${this.sourceColumns.displayName}::text, ''),
          NULLIF(u.${this.sourceColumns.login}::text, ''),
          'User ' || u.${this.sourceColumns.userId}::text
        ) AS display_name,
        COALESCE(u.${this.sourceColumns.passwordHash}::text, '') AS password_hash,
        COALESCE(u.${this.sourceColumns.discordUserId}::text, '') AS discord_user_id,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.${this.sourceColumns.roleKey}::text), NULL) AS role_keys,
        ARRAY_REMOVE(
          ARRAY_AGG(
            DISTINCT COALESCE(r.${this.sourceColumns.roleName}::text, r.${this.sourceColumns.roleKey}::text)
          ),
          NULL
        ) AS role_names
      FROM ${this.sourceTables.users} u
      LEFT JOIN ${this.sourceTables.userRoles} ur
        ON ur.user_id = u.${this.sourceColumns.userId}
      LEFT JOIN ${this.sourceTables.roles} r
        ON r.id = ur.role_id
      WHERE ${whereClause}
      ${activeClause}
      GROUP BY
        u.${this.sourceColumns.userId},
        u.${this.sourceColumns.login},
        u.${this.sourceColumns.displayName},
        u.${this.sourceColumns.passwordHash},
        u.${this.sourceColumns.discordUserId}
      LIMIT 1
    `;
  }

  mapHubUserRow(row) {
    const roleKeys = Array.isArray(row.role_keys) ? row.role_keys.filter(Boolean) : [];
    const roleNames = Array.isArray(row.role_names) ? row.role_names.filter(Boolean) : [];
    const flags = toRoleFlags(roleKeys, this.config);

    return {
      canAccessHub: flags.canAccessHub,
      discordUserId: row.discord_user_id || "",
      displayName: row.display_name,
      id: row.user_id,
      isAdmin: flags.isAdmin,
      isHead: flags.isHead,
      isModerator: flags.isModerator,
      loginName: row.login_name,
      roleKeys,
      roleNames
    };
  }

  mapShiftRow(row) {
    return {
      discordUserId: row.discord_user_id,
      endsAt: row.ends_at,
      id: row.shift_id,
      moderatorName: row.moderator_name,
      notes: row.notes,
      requiresClocking: Boolean(row.requires_clocking),
      sonaraUserId: row.sonara_user_id,
      startsAt: row.starts_at,
      teamKey: row.team_key,
      updatedAt: row.updated_at
    };
  }

  mapClockSessionRow(row) {
    return {
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
      closedSource: row.closed_source,
      discordUserId: row.discord_user_id,
      id: Number(row.id),
      openedSource: row.opened_source,
      shiftId: row.shift_id,
      sonaraUserId: row.sonara_user_id,
      status: row.status
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
}
