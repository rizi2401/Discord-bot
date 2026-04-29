import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const COMMAND_DEFINITIONS = [
  new SlashCommandBuilder()
    .setName("meine-schichten")
    .setDescription("Zeigt deine kommenden Schichten an."),
  new SlashCommandBuilder()
    .setName("verknuepfen")
    .setDescription("Verknuepft dein Discord-Konto sicher mit deinem Sonara-Konto."),
  new SlashCommandBuilder()
    .setName("einstempeln")
    .setDescription("Stempelt dich fuer deine aktuelle Schicht ein."),
  new SlashCommandBuilder()
    .setName("ausstempeln")
    .setDescription("Stempelt dich fuer deine aktuelle Schicht aus."),
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Erstellt ein Support-Ticket fuer dich."),
  new SlashCommandBuilder()
    .setName("raum-einladen")
    .setDescription("Laedt einen Nutzer in deinen privaten Voice-Raum ein.")
    .addUserOption((option) =>
      option.setName("nutzer").setDescription("Welcher Nutzer soll eingeladen werden?").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("raum-schliessen")
    .setDescription("Schliesst deinen privaten Voice-Raum sofort."),
  new SlashCommandBuilder()
    .setName("bot-status")
    .setDescription("Zeigt den Status und fehlende Konfigurationen des Bots.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("test-benachrichtigung")
    .setDescription("Sendet eine Testbenachrichtigung fuer die Bot-Funktionen.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("typ")
        .setDescription("Welche Benachrichtigung soll getestet werden?")
        .setRequired(true)
        .addChoices(
          { name: "dm", value: "dm" },
          { name: "team", value: "team" },
          { name: "incident", value: "incident" }
        )
    )
    .addStringOption((option) =>
      option.setName("team_key").setDescription("Optionaler teamKey fuer Team-Benachrichtigungen.")
    ),
  new SlashCommandBuilder()
    .setName("panel-posten")
    .setDescription("Postet ein interaktives Bot-Panel in den aktuellen Kanal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("typ")
        .setDescription("Welches Panel soll gepostet werden?")
        .setRequired(true)
        .addChoices(
          { name: "verify", value: "verify" },
          { name: "tickets", value: "tickets" },
          { name: "voice", value: "voice" }
        )
    )
];

export const buildApplicationCommands = () => {
  return COMMAND_DEFINITIONS.map((command) => command.toJSON());
};
