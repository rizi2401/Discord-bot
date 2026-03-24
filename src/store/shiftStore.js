import fs from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = {
  sentReminders: {},
  shifts: []
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
    endsAt,
    id,
    metadata: shift.metadata ?? {},
    moderatorName,
    notes: String(shift.notes ?? "").trim(),
    startsAt
  };
};

export class ShiftStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async ensureFile() {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(EMPTY_STATE, null, 2), "utf8");
    }
  }

  async readState() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");

    try {
      const parsed = JSON.parse(raw);

      return {
        sentReminders: parsed.sentReminders ?? {},
        shifts: Array.isArray(parsed.shifts) ? parsed.shifts : []
      };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  async writeState(state) {
    await this.ensureFile();
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  async getShifts() {
    const state = await this.readState();

    return state.shifts
      .map((shift) => normalizeShift(shift))
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  }

  async upsertShifts(shifts) {
    const normalized = shifts.map((shift) => normalizeShift(shift));
    const state = await this.readState();
    const byId = new Map(state.shifts.map((shift) => [shift.id, shift]));

    for (const shift of normalized) {
      byId.set(shift.id, shift);
    }

    const nextState = {
      sentReminders: state.sentReminders ?? {},
      shifts: Array.from(byId.values()).sort(
        (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)
      )
    };

    await this.writeState(nextState);
    return normalized;
  }

  async replaceFutureShifts(shifts) {
    const normalized = shifts.map((shift) => normalizeShift(shift));
    const state = await this.readState();
    const now = Date.now();
    const pastShifts = state.shifts.filter((shift) => Date.parse(shift.endsAt) <= now);

    await this.writeState({
      sentReminders: state.sentReminders ?? {},
      shifts: [...pastShifts, ...normalized].sort(
        (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)
      )
    });

    return normalized;
  }

  async getUpcomingShifts(referenceDate = new Date()) {
    const referenceTime = referenceDate.getTime();
    const shifts = await this.getShifts();

    return shifts.filter((shift) => Date.parse(shift.endsAt) > referenceTime);
  }

  async markReminderSent(shiftId, minutesBefore) {
    const state = await this.readState();
    const reminderKey = `${shiftId}:${minutesBefore}`;

    state.sentReminders[reminderKey] = new Date().toISOString();
    await this.writeState(state);
  }

  async hasReminderBeenSent(shiftId, minutesBefore) {
    const state = await this.readState();

    return Boolean(state.sentReminders[`${shiftId}:${minutesBefore}`]);
  }

  async prune(referenceDate = new Date()) {
    const state = await this.readState();
    const cutoff = referenceDate.getTime() - 1000 * 60 * 60 * 24 * 7;
    const activeShiftIds = new Set();

    const shifts = state.shifts.filter((shift) => {
      const keep = Date.parse(shift.endsAt) >= cutoff;

      if (keep) {
        activeShiftIds.add(shift.id);
      }

      return keep;
    });

    const sentReminders = Object.fromEntries(
      Object.entries(state.sentReminders ?? {}).filter(([key]) => {
        const [shiftId] = key.split(":");
        return activeShiftIds.has(shiftId);
      })
    );

    await this.writeState({ sentReminders, shifts });
  }
}
