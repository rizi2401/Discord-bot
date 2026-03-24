import process from "node:process";
import { config } from "./config.js";
import { createBot } from "./bot/createBot.js";
import { ReminderService } from "./services/reminderService.js";
import { ShiftStore } from "./store/shiftStore.js";
import { createServer } from "./web/createServer.js";

const main = async () => {
  const shiftStore = new ShiftStore(config.dataFile);
  const client = createBot({
    clientId: config.clientId,
    discordToken: config.discordToken,
    guildId: config.guildId,
    shiftStore
  });

  const reminderService = new ReminderService({
    client,
    reminderChannelId: config.reminderChannelId,
    reminderMinutesBefore: config.reminderMinutesBefore,
    shiftStore
  });

  const app = createServer({
    reminderService,
    shiftStore,
    timezone: config.timezone,
    webhookSecret: config.webhookSecret
  });

  await client.login(config.discordToken);
  reminderService.start();

  const server = app.listen(config.port, () => {
    console.log(`Shift webhook is listening on port ${config.port}`);
  });

  const shutdown = async () => {
    reminderService.stop();
    await new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    client.destroy();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
};

void main().catch((error) => {
  console.error("Application failed to start:", error);
  process.exit(1);
});
