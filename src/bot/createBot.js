import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

const createCommands = () => {
  return [
    new SlashCommandBuilder()
      .setName("meine-schichten")
      .setDescription("Zeigt deine kommenden Moderationsschichten an.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("schicht-stats")
      .setDescription("Zeigt an, wie viele kommende Schichten gespeichert sind.")
      .toJSON()
  ];
};

const formatShiftLine = (shift) => {
  const unixTimestamp = Math.floor(Date.parse(shift.startsAt) / 1000);
  const notes = shift.notes ? ` | ${shift.notes}` : "";
  return `- <t:${unixTimestamp}:F>${notes}`;
};

export const createBot = ({ clientId, discordToken, guildId, shiftStore }) => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord bot connected as ${readyClient.user.tag}`);

    if (!guildId) {
      console.warn("GUILD_ID is not configured. Slash commands were not registered.");
      return;
    }

    const rest = new REST({ version: "10" }).setToken(discordToken);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: createCommands()
    });

    console.log(`Registered slash commands for guild ${guildId}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "meine-schichten") {
      const upcomingShifts = await shiftStore.getUpcomingShifts();
      const userShifts = upcomingShifts.filter(
        (shift) => shift.discordUserId === interaction.user.id
      );

      if (userShifts.length === 0) {
        await interaction.reply({
          content: "Fuer dich ist aktuell keine kommende Schicht eingetragen.",
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: [
          "Deine kommenden Schichten:",
          userShifts.slice(0, 10).map((shift) => formatShiftLine(shift)).join("\n")
        ].join("\n"),
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "schicht-stats") {
      const upcomingShifts = await shiftStore.getUpcomingShifts();
      await interaction.reply({
        content: `Es sind aktuell ${upcomingShifts.length} kommende Schichten gespeichert.`,
        ephemeral: true
      });
    }
  });

  return client;
};
