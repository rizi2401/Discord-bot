const TICK_INTERVAL_MS = 60_000;

const formatShiftMessage = (shift, minutesBefore) => {
  const unixTimestamp = Math.floor(Date.parse(shift.startsAt) / 1000);
  const intro =
    minutesBefore >= 1440
      ? `deine Moderationsschicht startet morgen`
      : `deine Moderationsschicht startet in ${minutesBefore} Minuten`;
  const notesLine = shift.notes ? `\nNotiz: ${shift.notes}` : "";

  return [
    `Hallo ${shift.moderatorName}, ${intro}.`,
    `Beginn: <t:${unixTimestamp}:F>`,
    `Relativ: <t:${unixTimestamp}:R>${notesLine}`
  ].join("\n");
};

export class ReminderService {
  constructor({ client, reminderChannelId, reminderMinutesBefore, shiftStore }) {
    this.client = client;
    this.reminderChannelId = reminderChannelId;
    this.reminderMinutesBefore = reminderMinutesBefore;
    this.shiftStore = shiftStore;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runCycle();
    }, TICK_INTERVAL_MS);

    void this.runCycle();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCycle() {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.shiftStore.prune();
      const upcomingShifts = await this.shiftStore.getUpcomingShifts();
      const now = Date.now();

      for (const shift of upcomingShifts) {
        const startTime = Date.parse(shift.startsAt);

        for (const minutesBefore of this.reminderMinutesBefore) {
          const reminderTime = startTime - minutesBefore * 60_000;
          const graceLimit = reminderTime + TICK_INTERVAL_MS * 2;

          if (now < reminderTime || now > graceLimit) {
            continue;
          }

          const alreadySent = await this.shiftStore.hasReminderBeenSent(shift.id, minutesBefore);

          if (alreadySent) {
            continue;
          }

          await this.sendReminder(shift, minutesBefore);
          await this.shiftStore.markReminderSent(shift.id, minutesBefore);
        }
      }
    } catch (error) {
      console.error("Reminder cycle failed:", error);
    } finally {
      this.running = false;
    }
  }

  async sendReminder(shift, minutesBefore) {
    const content = formatShiftMessage(shift, minutesBefore);
    const user = await this.client.users.fetch(shift.discordUserId);

    try {
      await user.send(content);
      return;
    } catch (directMessageError) {
      if (!this.reminderChannelId) {
        throw directMessageError;
      }
    }

    const channel = await this.client.channels.fetch(this.reminderChannelId);

    if (!channel?.isTextBased()) {
      throw new Error("Reminder channel is not a text channel.");
    }

    await channel.send({
      content: `<@${shift.discordUserId}> ${content}`
    });
  }
}
