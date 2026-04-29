import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import DatabaseDriver from "better-sqlite3";

const asIso = (value = new Date()) => {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const normalizeShift = (shift) => {
  if (!shift || typeof shift !== "object") {
    throw new Error("Shift must be an object.");
  }

  const id = String(shift.id ?? "").trim();
  const moderatorName = String(shift.moderatorName ?? "").trim();
  const discordUserId = String(shift.discordUserId ?? "").trim();
  const startsAt = String(shift.startsAt ?? "").trim();
  const endsAt = String(shift.endsAt ?? "").trim();

  if (!id) {
    throw new Error("Shift is missing id.");
  }

  if (!moderatorName) {
    throw new Error(`Shift ${id} is missing moderatorName.`);
  }

  if (!discordUserId) {
    throw new Error(`Shift ${id} is missing discordUserId.`);
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
    discordUserId,
    endsAt: asIso(endsAt),
    id,
    moderatorName,
    notes: String(shift.notes ?? "").trim(),
    requiresClocking: shift.requiresClocking === false ? 0 : 1,
    startsAt: asIso(startsAt),
    teamKey: String(shift.teamKey ?? "").trim(),
    updatedAt: shift.updatedAt ? asIso(shift.updatedAt) : asIso()
  };
};

const shiftChanged = (left, right) => {
  return (
    left.team_key !== right.teamKey ||
    left.moderator_name !== right.moderatorName ||
    left.discord_user_id !== right.discordUserId ||
    left.starts_at !== right.startsAt ||
    left.ends_at !== right.endsAt ||
    left.notes !== right.notes ||
    Number(left.requires_clocking) !== Number(right.requiresClocking) ||
    (left.updated_at ?? "") !== right.updatedAt
  );
};

export class BotDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseDriver(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
    this.prepareStatements();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_routes (
        team_key TEXT PRIMARY KEY,
        role_id TEXT NOT NULL DEFAULT '',
        channel_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shifts (
        shift_id TEXT PRIMARY KEY,
        team_key TEXT NOT NULL DEFAULT '',
        moderator_name TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        requires_clocking INTEGER NOT NULL DEFAULT 1,
        last_synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_events (
        shift_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (shift_id, event_key)
      );

      CREATE TABLE IF NOT EXISTS clock_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        checked_in_at TEXT NOT NULL,
        checked_out_at TEXT,
        opened_source TEXT NOT NULL,
        closed_source TEXT,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL UNIQUE,
        creator_id TEXT NOT NULL,
        status TEXT NOT NULL,
        claimed_by TEXT,
        created_at TEXT NOT NULL,
        closed_at TEXT,
        closed_by TEXT
      );

      CREATE TABLE IF NOT EXISTS voice_rooms (
        channel_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        empty_since TEXT,
        invited_user_ids TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS panel_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        redirect_path TEXT NOT NULL DEFAULT '/panel'
      );
    `);
  }

  prepareStatements() {
    this.selectAllSettingsStatement = this.db.prepare(
      "SELECT key, value FROM settings ORDER BY key"
    );
    this.upsertSettingStatement = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    this.selectTeamRoutesStatement = this.db.prepare(
      "SELECT team_key, role_id, channel_id FROM team_routes ORDER BY team_key"
    );
    this.upsertTeamRouteStatement = this.db.prepare(`
      INSERT INTO team_routes (team_key, role_id, channel_id, updated_at)
      VALUES (@teamKey, @roleId, @channelId, @updatedAt)
      ON CONFLICT(team_key) DO UPDATE SET
        role_id = excluded.role_id,
        channel_id = excluded.channel_id,
        updated_at = excluded.updated_at
    `);
    this.deleteTeamRouteStatement = this.db.prepare(
      "DELETE FROM team_routes WHERE team_key = ?"
    );
    this.selectUpcomingShiftsStatement = this.db.prepare(`
      SELECT *
      FROM shifts
      WHERE ends_at > ?
      ORDER BY starts_at ASC
    `);
    this.selectAllFutureShiftsStatement = this.db.prepare(`
      SELECT *
      FROM shifts
      WHERE ends_at > ?
      ORDER BY starts_at ASC
    `);
    this.selectShiftByIdStatement = this.db.prepare(
      "SELECT * FROM shifts WHERE shift_id = ?"
    );
    this.deleteShiftStatement = this.db.prepare("DELETE FROM shifts WHERE shift_id = ?");
    this.upsertShiftStatement = this.db.prepare(`
      INSERT INTO shifts (
        shift_id,
        team_key,
        moderator_name,
        discord_user_id,
        starts_at,
        ends_at,
        notes,
        updated_at,
        requires_clocking,
        last_synced_at
      ) VALUES (
        @shiftId,
        @teamKey,
        @moderatorName,
        @discordUserId,
        @startsAt,
        @endsAt,
        @notes,
        @updatedAt,
        @requiresClocking,
        @lastSyncedAt
      )
      ON CONFLICT(shift_id) DO UPDATE SET
        team_key = excluded.team_key,
        moderator_name = excluded.moderator_name,
        discord_user_id = excluded.discord_user_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        requires_clocking = excluded.requires_clocking,
        last_synced_at = excluded.last_synced_at
    `);
    this.deleteNotificationsByShiftStatement = this.db.prepare(
      "DELETE FROM notification_events WHERE shift_id = ?"
    );
    this.selectNotificationEventStatement = this.db.prepare(
      "SELECT sent_at FROM notification_events WHERE shift_id = ? AND event_key = ?"
    );
    this.insertNotificationEventStatement = this.db.prepare(`
      INSERT INTO notification_events (shift_id, event_key, sent_at)
      VALUES (?, ?, ?)
      ON CONFLICT(shift_id, event_key) DO UPDATE SET sent_at = excluded.sent_at
    `);
    this.selectOpenClockSessionForShiftStatement = this.db.prepare(`
      SELECT *
      FROM clock_sessions
      WHERE shift_id = ? AND status = 'open'
      ORDER BY id DESC
      LIMIT 1
    `);
    this.selectLatestClockSessionForShiftStatement = this.db.prepare(`
      SELECT *
      FROM clock_sessions
      WHERE shift_id = ?
      ORDER BY id DESC
      LIMIT 1
    `);
    this.insertClockSessionStatement = this.db.prepare(`
      INSERT INTO clock_sessions (
        shift_id,
        discord_user_id,
        checked_in_at,
        checked_out_at,
        opened_source,
        closed_source,
        status
      ) VALUES (?, ?, ?, NULL, ?, NULL, 'open')
    `);
    this.closeClockSessionStatement = this.db.prepare(`
      UPDATE clock_sessions
      SET checked_out_at = ?, closed_source = ?, status = 'closed'
      WHERE id = ?
    `);
    this.selectActiveClockSessionsStatement = this.db.prepare(`
      SELECT *
      FROM clock_sessions
      WHERE status = 'open'
      ORDER BY checked_in_at ASC
    `);
    this.selectCurrentUserOpenSessionStatement = this.db.prepare(`
      SELECT *
      FROM clock_sessions
      WHERE discord_user_id = ? AND status = 'open'
      ORDER BY checked_in_at DESC
      LIMIT 1
    `);
    this.selectOpenIncidentStatement = this.db.prepare(`
      SELECT *
      FROM incidents
      WHERE shift_id = ? AND type = ? AND status = 'open'
      LIMIT 1
    `);
    this.insertIncidentStatement = this.db.prepare(`
      INSERT INTO incidents (
        id,
        type,
        shift_id,
        discord_user_id,
        created_at,
        resolved_at,
        status,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, NULL, 'open', ?)
    `);
    this.resolveIncidentByTypeStatement = this.db.prepare(`
      UPDATE incidents
      SET status = 'resolved', resolved_at = ?
      WHERE shift_id = ? AND type = ? AND status = 'open'
    `);
    this.selectOpenIncidentsStatement = this.db.prepare(`
      SELECT *
      FROM incidents
      WHERE status = 'open'
      ORDER BY created_at ASC
    `);
    this.selectOpenTicketByCreatorStatement = this.db.prepare(`
      SELECT *
      FROM tickets
      WHERE creator_id = ? AND status = 'open'
      LIMIT 1
    `);
    this.selectTicketByChannelStatement = this.db.prepare(
      "SELECT * FROM tickets WHERE channel_id = ?"
    );
    this.insertTicketStatement = this.db.prepare(`
      INSERT INTO tickets (
        id,
        channel_id,
        creator_id,
        status,
        claimed_by,
        created_at,
        closed_at,
        closed_by
      ) VALUES (?, ?, ?, 'open', NULL, ?, NULL, NULL)
    `);
    this.claimTicketStatement = this.db.prepare(`
      UPDATE tickets
      SET claimed_by = ?
      WHERE channel_id = ? AND status = 'open'
    `);
    this.closeTicketStatement = this.db.prepare(`
      UPDATE tickets
      SET status = 'closed', closed_at = ?, closed_by = ?
      WHERE channel_id = ?
    `);
    this.selectOpenTicketsStatement = this.db.prepare(`
      SELECT *
      FROM tickets
      WHERE status = 'open'
      ORDER BY created_at ASC
    `);
    this.insertVoiceRoomStatement = this.db.prepare(`
      INSERT INTO voice_rooms (channel_id, owner_id, created_at, empty_since, invited_user_ids)
      VALUES (?, ?, ?, NULL, '')
      ON CONFLICT(channel_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        created_at = excluded.created_at,
        empty_since = NULL,
        invited_user_ids = ''
    `);
    this.selectVoiceRoomStatement = this.db.prepare(
      "SELECT * FROM voice_rooms WHERE channel_id = ?"
    );
    this.selectOwnedVoiceRoomStatement = this.db.prepare(`
      SELECT *
      FROM voice_rooms
      WHERE owner_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    this.updateVoiceRoomInvitesStatement = this.db.prepare(`
      UPDATE voice_rooms
      SET invited_user_ids = ?
      WHERE channel_id = ?
    `);
    this.markVoiceRoomEmptyStatement = this.db.prepare(`
      UPDATE voice_rooms
      SET empty_since = ?
      WHERE channel_id = ?
    `);
    this.clearVoiceRoomEmptyStatement = this.db.prepare(`
      UPDATE voice_rooms
      SET empty_since = NULL
      WHERE channel_id = ?
    `);
    this.selectStaleVoiceRoomsStatement = this.db.prepare(`
      SELECT *
      FROM voice_rooms
      WHERE empty_since IS NOT NULL AND empty_since <= ?
    `);
    this.deleteVoiceRoomStatement = this.db.prepare(
      "DELETE FROM voice_rooms WHERE channel_id = ?"
    );
    this.selectAllVoiceRoomsStatement = this.db.prepare(
      "SELECT * FROM voice_rooms ORDER BY created_at ASC"
    );
    this.insertOutboxEventStatement = this.db.prepare(`
      INSERT INTO outbox_events (
        id,
        event_type,
        payload_json,
        status,
        attempts,
        next_attempt_at,
        last_error,
        created_at,
        delivered_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, NULL)
    `);
    this.selectDueOutboxEventsStatement = this.db.prepare(`
      SELECT *
      FROM outbox_events
      WHERE status IN ('pending', 'retry') AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `);
    this.markOutboxDeliveredStatement = this.db.prepare(`
      UPDATE outbox_events
      SET status = 'delivered', delivered_at = ?, last_error = NULL
      WHERE id = ?
    `);
    this.markOutboxRetryStatement = this.db.prepare(`
      UPDATE outbox_events
      SET status = 'retry', attempts = ?, last_error = ?, next_attempt_at = ?
      WHERE id = ?
    `);
    this.selectPendingOutboxCountStatement = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM outbox_events
      WHERE status IN ('pending', 'retry')
    `);
    this.insertPanelSessionStatement = this.db.prepare(`
      INSERT INTO panel_sessions (session_id, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    this.selectPanelSessionStatement = this.db.prepare(
      "SELECT * FROM panel_sessions WHERE session_id = ?"
    );
    this.deletePanelSessionStatement = this.db.prepare(
      "DELETE FROM panel_sessions WHERE session_id = ?"
    );
    this.deleteExpiredPanelSessionsStatement = this.db.prepare(
      "DELETE FROM panel_sessions WHERE expires_at <= ?"
    );
    this.insertOauthStateStatement = this.db.prepare(`
      INSERT INTO oauth_states (state, created_at, redirect_path)
      VALUES (?, ?, ?)
      ON CONFLICT(state) DO UPDATE SET created_at = excluded.created_at, redirect_path = excluded.redirect_path
    `);
    this.selectOauthStateStatement = this.db.prepare(
      "SELECT * FROM oauth_states WHERE state = ?"
    );
    this.deleteOauthStateStatement = this.db.prepare("DELETE FROM oauth_states WHERE state = ?");
    this.deleteExpiredOauthStatesStatement = this.db.prepare(
      "DELETE FROM oauth_states WHERE created_at <= ?"
    );
    this.dashboardStatsStatement = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM shifts WHERE ends_at > @nowIso) AS upcomingShiftCount,
        (SELECT COUNT(*) FROM tickets WHERE status = 'open') AS openTicketCount,
        (SELECT COUNT(*) FROM clock_sessions WHERE status = 'open') AS activeClockCount,
        (SELECT COUNT(*) FROM incidents WHERE status = 'open') AS openIncidentCount,
        (SELECT COUNT(*) FROM voice_rooms) AS activeVoiceRoomCount
    `);
  }

  getAllSettings() {
    return Object.fromEntries(
      this.selectAllSettingsStatement.all().map((row) => [row.key, row.value])
    );
  }

  setManySettings(entries) {
    const updatedAt = asIso();
    const run = this.db.transaction((items) => {
      for (const [key, value] of Object.entries(items)) {
        this.upsertSettingStatement.run({ key, updatedAt, value: String(value ?? "") });
      }
    });
    run(entries);
  }

  listTeamRoutes() {
    return this.selectTeamRoutesStatement.all().map((row) => ({
      channelId: row.channel_id,
      roleId: row.role_id,
      teamKey: row.team_key
    }));
  }

  upsertTeamRoute({ teamKey, roleId, channelId }) {
    this.upsertTeamRouteStatement.run({
      channelId: String(channelId ?? "").trim(),
      roleId: String(roleId ?? "").trim(),
      teamKey: String(teamKey ?? "").trim(),
      updatedAt: asIso()
    });
  }

  deleteTeamRoute(teamKey) {
    this.deleteTeamRouteStatement.run(teamKey);
  }

  getUpcomingShifts(referenceDate = new Date()) {
    return this.selectUpcomingShiftsStatement.all(asIso(referenceDate)).map(this.mapShiftRow);
  }

  getShiftById(shiftId) {
    const row = this.selectShiftByIdStatement.get(shiftId);
    return row ? this.mapShiftRow(row) : null;
  }

  syncShifts({ mode = "upsert", generatedAt = asIso(), shifts = [] }) {
    const normalized = shifts.map((shift) => normalizeShift(shift));
    const nowIso = asIso(generatedAt);
    const oldFutureRows = this.selectAllFutureShiftsStatement.all(nowIso);
    const oldFutureMap = new Map(oldFutureRows.map((row) => [row.shift_id, row]));
    const changes = { created: [], removed: [], updated: [] };

    const transaction = this.db.transaction(() => {
      const seenIds = new Set();

      for (const shift of normalized) {
        seenIds.add(shift.id);
        const previous = oldFutureMap.get(shift.id);

        if (!previous) {
          changes.created.push(shift);
        } else if (shiftChanged(previous, shift)) {
          changes.updated.push({
            current: shift,
            previous: this.mapShiftRow(previous)
          });
          this.deleteNotificationsByShiftStatement.run(shift.id);
        }

        this.upsertShiftStatement.run({
          discordUserId: shift.discordUserId,
          endsAt: shift.endsAt,
          lastSyncedAt: nowIso,
          moderatorName: shift.moderatorName,
          notes: shift.notes,
          requiresClocking: shift.requiresClocking,
          shiftId: shift.id,
          startsAt: shift.startsAt,
          teamKey: shift.teamKey,
          updatedAt: shift.updatedAt
        });
      }

      if (mode === "replace") {
        for (const row of oldFutureRows) {
          if (seenIds.has(row.shift_id)) {
            continue;
          }

          changes.removed.push(this.mapShiftRow(row));
          this.deleteShiftStatement.run(row.shift_id);
          this.deleteNotificationsByShiftStatement.run(row.shift_id);
        }
      }
    });

    transaction();

    return {
      changes,
      saved: normalized
    };
  }

  hasNotification(shiftId, eventKey) {
    return Boolean(this.selectNotificationEventStatement.get(shiftId, eventKey));
  }

  markNotification(shiftId, eventKey, sentAt = asIso()) {
    this.insertNotificationEventStatement.run(shiftId, eventKey, asIso(sentAt));
  }

  getOpenClockSessionForShift(shiftId) {
    const row = this.selectOpenClockSessionForShiftStatement.get(shiftId);
    return row ? this.mapClockSessionRow(row) : null;
  }

  getLatestClockSessionForShift(shiftId) {
    const row = this.selectLatestClockSessionForShiftStatement.get(shiftId);
    return row ? this.mapClockSessionRow(row) : null;
  }

  getCurrentOpenSessionForUser(discordUserId) {
    const row = this.selectCurrentUserOpenSessionStatement.get(discordUserId);
    return row ? this.mapClockSessionRow(row) : null;
  }

  createCheckIn({ shiftId, discordUserId, source, occurredAt = asIso() }) {
    const existing = this.getOpenClockSessionForShift(shiftId);

    if (existing) {
      return existing;
    }

    this.insertClockSessionStatement.run(shiftId, discordUserId, asIso(occurredAt), source);
    this.resolveIncidentByType(shiftId, "no_show", occurredAt);
    return this.getOpenClockSessionForShift(shiftId);
  }

  createCheckOut({ shiftId, source, occurredAt = asIso() }) {
    const existing = this.getOpenClockSessionForShift(shiftId);

    if (!existing) {
      return null;
    }

    this.closeClockSessionStatement.run(asIso(occurredAt), source, existing.id);
    this.resolveIncidentByType(shiftId, "checkout_missed", occurredAt);
    return this.getLatestClockSessionForShift(shiftId);
  }

  listActiveClockSessions() {
    return this.selectActiveClockSessionsStatement.all().map(this.mapClockSessionRow);
  }

  findOpenIncident(shiftId, type) {
    const row = this.selectOpenIncidentStatement.get(shiftId, type);
    return row ? this.mapIncidentRow(row) : null;
  }

  createIncident({ type, shiftId, discordUserId, metadata = {}, createdAt = asIso() }) {
    const existing = this.findOpenIncident(shiftId, type);

    if (existing) {
      return existing;
    }

    const incident = {
      createdAt: asIso(createdAt),
      discordUserId,
      id: randomUUID(),
      metadataJson: JSON.stringify(metadata),
      shiftId,
      type
    };

    this.insertIncidentStatement.run(
      incident.id,
      incident.type,
      incident.shiftId,
      incident.discordUserId,
      incident.createdAt,
      incident.metadataJson
    );

    return this.findOpenIncident(shiftId, type);
  }

  resolveIncidentByType(shiftId, type, resolvedAt = asIso()) {
    this.resolveIncidentByTypeStatement.run(asIso(resolvedAt), shiftId, type);
  }

  listOpenIncidents() {
    return this.selectOpenIncidentsStatement.all().map(this.mapIncidentRow);
  }

  getOpenTicketByCreator(creatorId) {
    const row = this.selectOpenTicketByCreatorStatement.get(creatorId);
    return row ? this.mapTicketRow(row) : null;
  }

  getTicketByChannel(channelId) {
    const row = this.selectTicketByChannelStatement.get(channelId);
    return row ? this.mapTicketRow(row) : null;
  }

  createTicket({ channelId, creatorId, createdAt = asIso() }) {
    const ticketId = randomUUID();
    this.insertTicketStatement.run(ticketId, channelId, creatorId, asIso(createdAt));
    return this.getTicketByChannel(channelId);
  }

  claimTicket(channelId, claimedBy) {
    this.claimTicketStatement.run(claimedBy, channelId);
    return this.getTicketByChannel(channelId);
  }

  closeTicket(channelId, closedBy, closedAt = asIso()) {
    this.closeTicketStatement.run(asIso(closedAt), closedBy, channelId);
    return this.getTicketByChannel(channelId);
  }

  listOpenTickets() {
    return this.selectOpenTicketsStatement.all().map(this.mapTicketRow);
  }

  createVoiceRoom({ channelId, ownerId, createdAt = asIso() }) {
    this.insertVoiceRoomStatement.run(channelId, ownerId, asIso(createdAt));
    return this.getVoiceRoom(channelId);
  }

  getVoiceRoom(channelId) {
    const row = this.selectVoiceRoomStatement.get(channelId);
    return row ? this.mapVoiceRoomRow(row) : null;
  }

  getLatestOwnedVoiceRoom(ownerId) {
    const row = this.selectOwnedVoiceRoomStatement.get(ownerId);
    return row ? this.mapVoiceRoomRow(row) : null;
  }

  setVoiceRoomInvites(channelId, invitedUserIds) {
    this.updateVoiceRoomInvitesStatement.run(invitedUserIds.join(","), channelId);
    return this.getVoiceRoom(channelId);
  }

  markVoiceRoomEmpty(channelId, emptySince = asIso()) {
    this.markVoiceRoomEmptyStatement.run(asIso(emptySince), channelId);
  }

  clearVoiceRoomEmpty(channelId) {
    this.clearVoiceRoomEmptyStatement.run(channelId);
  }

  listVoiceRooms() {
    return this.selectAllVoiceRoomsStatement.all().map(this.mapVoiceRoomRow);
  }

  listStaleVoiceRooms(beforeDate) {
    return this.selectStaleVoiceRoomsStatement.all(asIso(beforeDate)).map(this.mapVoiceRoomRow);
  }

  deleteVoiceRoom(channelId) {
    this.deleteVoiceRoomStatement.run(channelId);
  }

  enqueueOutboxEvent({ eventType, payload, createdAt = asIso() }) {
    const event = {
      createdAt: asIso(createdAt),
      eventType,
      id: randomUUID(),
      nextAttemptAt: asIso(createdAt),
      payloadJson: JSON.stringify(payload)
    };

    this.insertOutboxEventStatement.run(
      event.id,
      event.eventType,
      event.payloadJson,
      event.nextAttemptAt,
      event.createdAt
    );

    return event;
  }

  listDueOutboxEvents(referenceDate = new Date(), limit = 10) {
    return this.selectDueOutboxEventsStatement
      .all(asIso(referenceDate), limit)
      .map(this.mapOutboxRow);
  }

  markOutboxDelivered(id, deliveredAt = asIso()) {
    this.markOutboxDeliveredStatement.run(asIso(deliveredAt), id);
  }

  markOutboxRetry({ id, attempts, errorMessage, nextAttemptAt }) {
    this.markOutboxRetryStatement.run(attempts, errorMessage, asIso(nextAttemptAt), id);
  }

  getPendingOutboxCount() {
    return this.selectPendingOutboxCountStatement.get().count;
  }

  createPanelSession({ sessionId, userId, createdAt = asIso(), expiresAt }) {
    this.insertPanelSessionStatement.run(sessionId, userId, asIso(createdAt), asIso(expiresAt));
  }

  getPanelSession(sessionId) {
    const row = this.selectPanelSessionStatement.get(sessionId);
    return row
      ? {
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          sessionId: row.session_id,
          userId: row.user_id
        }
      : null;
  }

  deletePanelSession(sessionId) {
    this.deletePanelSessionStatement.run(sessionId);
  }

  deleteExpiredPanelSessions(referenceDate = new Date()) {
    this.deleteExpiredPanelSessionsStatement.run(asIso(referenceDate));
  }

  createOauthState({ state, redirectPath = "/panel", createdAt = asIso() }) {
    this.insertOauthStateStatement.run(state, asIso(createdAt), redirectPath);
  }

  consumeOauthState(state) {
    const row = this.selectOauthStateStatement.get(state);
    if (!row) {
      return null;
    }

    this.deleteOauthStateStatement.run(state);
    return {
      createdAt: row.created_at,
      redirectPath: row.redirect_path,
      state: row.state
    };
  }

  deleteExpiredOauthStates(referenceDate = new Date()) {
    const cutoff = new Date(referenceDate.getTime() - 1000 * 60 * 10);
    this.deleteExpiredOauthStatesStatement.run(asIso(cutoff));
  }

  getDashboardStats(referenceDate = new Date()) {
    const row = this.dashboardStatsStatement.get({ nowIso: asIso(referenceDate) });
    return {
      activeClockCount: row.activeClockCount,
      activeVoiceRoomCount: row.activeVoiceRoomCount,
      openIncidentCount: row.openIncidentCount,
      openTicketCount: row.openTicketCount,
      upcomingShiftCount: row.upcomingShiftCount
    };
  }

  close() {
    this.db.close();
  }

  mapShiftRow(row) {
    return {
      discordUserId: row.discord_user_id,
      endsAt: row.ends_at,
      id: row.shift_id,
      moderatorName: row.moderator_name,
      notes: row.notes,
      requiresClocking: Boolean(row.requires_clocking),
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
      id: row.id,
      openedSource: row.opened_source,
      shiftId: row.shift_id,
      status: row.status
    };
  }

  mapIncidentRow(row) {
    return {
      createdAt: row.created_at,
      discordUserId: row.discord_user_id,
      id: row.id,
      metadata: JSON.parse(row.metadata_json ?? "{}"),
      resolvedAt: row.resolved_at,
      shiftId: row.shift_id,
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

  mapOutboxRow(row) {
    return {
      attempts: row.attempts,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
      eventType: row.event_type,
      id: row.id,
      lastError: row.last_error,
      nextAttemptAt: row.next_attempt_at,
      payload: JSON.parse(row.payload_json),
      status: row.status
    };
  }
}
