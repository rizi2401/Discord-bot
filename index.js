import process from "node:process";
import { config } from "./config.js";
import { createBot } from "./bot/createBot.js";
import { AutomationService } from "./services/automationService.js";
import { BotDatabase } from "./store/database.js";
import { createServer } from "./web/createServer.js";

const main = async () => {
  const database = new BotDatabase(config.databaseFile);
  const { client, runtime } = createBot({
    config,
    database
  });

  const automationService = new AutomationService({ runtime });
  const app = createServer({
    client,
    config,
    database,
    runtime
  });

  await client.login(config.discordToken);
  automationService.start();

  const server = app.listen(config.port, () => {
    console.log(`Operations bot web server is listening on port ${config.port}`);
  });

  const shutdown = async () => {
    automationService.stop();
    await new Promise((resolve) => server.close(resolve));
    client.destroy();
    database.close();
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
