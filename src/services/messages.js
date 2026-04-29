const asDiscordTimestamp = (value, style = "F") => {
  const unixTimestamp = Math.floor(Date.parse(value) / 1000);
  return `<t:${unixTimestamp}:${style}>`;
};

export const buildWelcomeMessage = ({ member, settings }) => {
  const rulesHint = settings.rulesChannelId
    ? `Bitte lies zuerst <#${settings.rulesChannelId}> und bestaetige dort die Regeln.`
    : "Bitte lies die Regeln und bestaetige sie im Regelbereich.";

  return [
    `Willkommen auf dem Server, <@${member.id}>!`,
    rulesHint,
    "Danach bekommst du automatisch deine Mitgliederrolle."
  ].join("\n");
};

export const buildVerifyPanelContent = () => {
  return {
    content: [
      "## Regeln bestaetigen",
      "Lies die Regeln und bestaetige sie anschliessend mit dem Button.",
      "Danach vergibt der Bot automatisch deine Mitgliederrolle."
    ].join("\n")
  };
};

export const buildTicketPanelContent = () => {
  return {
    content: [
      "## Support und Tickets",
      "Wenn du Hilfe brauchst, erstelle hier ein Ticket.",
      "Der Bot legt dafuer einen privaten Kanal fuer dich und das Team an."
    ].join("\n")
  };
};

export const buildVoicePanelContent = () => {
  return {
    content: [
      "## Privaten Sprachraum erstellen",
      "Mit dem Button erstellt der Bot einen temporaeren privaten Voice-Raum fuer dich.",
      "Leere Raeume werden automatisch wieder entfernt."
    ].join("\n")
  };
};

export const buildShiftListLine = (shift) => {
  const notes = shift.notes ? ` | ${shift.notes}` : "";
  return `- ${asDiscordTimestamp(shift.startsAt, "F")} bis ${asDiscordTimestamp(shift.endsAt, "t")}${notes}`;
};

export const buildShiftReminderMessage = ({ shift, type, settings }) => {
  const introByType = {
    end: "deine Schicht endet jetzt. Bitte stemple dich aus.",
    pre: "deine Schicht startet bald.",
    start: "deine Schicht startet jetzt. Bitte stemple dich ein."
  };

  const reminderText =
    type === "pre"
      ? `Vorwarnung fuer ${asDiscordTimestamp(shift.startsAt, "R")}`
      : `Schicht: ${asDiscordTimestamp(shift.startsAt, "F")} bis ${asDiscordTimestamp(shift.endsAt, "t")}`;

  const extra =
    type === "pre"
      ? `Wenn du fuer diese Schicht eingeteilt bist, halte dich bitte bereit.${shift.notes ? `\nNotiz: ${shift.notes}` : ""}`
      : shift.requiresClocking
        ? `Bitte nutze den Button unten oder die Slash-Commands, falls die DM-Buttons nicht funktionieren.${shift.notes ? `\nNotiz: ${shift.notes}` : ""}`
        : `${shift.notes ? `Notiz: ${shift.notes}\n` : ""}Du bist automatisch informiert worden, weil du fuer diese Schicht eingeteilt bist.`;

  return [
    `Hallo ${shift.moderatorName}, ${introByType[type] ?? introByType.pre}`,
    reminderText,
    extra,
    `Timezone: ${settings.raw ? settings.raw.timezone ?? "Europe/Berlin" : "Europe/Berlin"}`
  ].join("\n");
};

export const buildShiftChangeDm = ({ changeType, shift, previousShift = null }) => {
  if (changeType === "removed") {
    return [
      "Deine Schicht wurde entfernt oder abgesagt.",
      `Bisheriger Termin: ${asDiscordTimestamp(shift.startsAt, "F")} bis ${asDiscordTimestamp(shift.endsAt, "t")}`,
      shift.notes ? `Notiz: ${shift.notes}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (changeType === "updated" && previousShift) {
    return [
      "Deine Schicht wurde aktualisiert.",
      `Neu: ${asDiscordTimestamp(shift.startsAt, "F")} bis ${asDiscordTimestamp(shift.endsAt, "t")}`,
      `Vorher: ${asDiscordTimestamp(previousShift.startsAt, "F")} bis ${asDiscordTimestamp(previousShift.endsAt, "t")}`,
      shift.notes ? `Notiz: ${shift.notes}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Du wurdest einer neuen Schicht zugeordnet.",
    `${asDiscordTimestamp(shift.startsAt, "F")} bis ${asDiscordTimestamp(shift.endsAt, "t")}`,
    shift.notes ? `Notiz: ${shift.notes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildTeamShiftSummary = ({ teamKey, route, changes, introText }) => {
  const mention = route.roleId ? `<@&${route.roleId}> ` : "";
  const lines = changes.map((change) => {
    if (change.type === "removed") {
      return `- Entfernt: ${change.shift.moderatorName} | ${asDiscordTimestamp(change.shift.startsAt, "F")}`;
    }

    if (change.type === "updated") {
      return `- Aktualisiert: ${change.shift.moderatorName} | ${asDiscordTimestamp(change.shift.startsAt, "F")}`;
    }

    return `- Neu: ${change.shift.moderatorName} | ${asDiscordTimestamp(change.shift.startsAt, "F")}`;
  });

  return [mention + (introText || "Es gibt neue oder geaenderte Schichten."), `Team: ${teamKey}`, ...lines]
    .filter(Boolean)
    .join("\n");
};

export const buildIncidentMessage = ({ incidentType, shift }) => {
  const headline =
    incidentType === "no_show"
      ? "Ein Teammitglied hat seine Schicht nicht rechtzeitig angetreten."
      : "Ein Teammitglied hat sich nicht rechtzeitig ausgestempelt.";
  const affectedLabel = shift.discordUserId
    ? `<@${shift.discordUserId}> (${shift.moderatorName})`
    : shift.moderatorName;

  return [
    headline,
    `Betroffen: ${affectedLabel}`,
    `Schicht: ${asDiscordTimestamp(shift.startsAt, "F")} bis ${asDiscordTimestamp(shift.endsAt, "t")}`,
    shift.notes ? `Notiz: ${shift.notes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildTicketIntro = (userId) => {
  return [
    `Hallo <@${userId}>, dein Ticket wurde erstellt.`,
    "Beschreibe kurz dein Anliegen. Das Team kann das Ticket claimen oder direkt beantworten."
  ].join("\n");
};

export const buildBotStatusLines = ({ diagnostics }) => {
  const missing = diagnostics.missingSettings.length
    ? diagnostics.missingSettings.join(", ")
    : "keine";

  return [
    `Konfigurationsluecken: ${missing}`,
    `Kommende Schichten: ${diagnostics.stats.upcomingShiftCount}`,
    `Offene Tickets: ${diagnostics.stats.openTicketCount}`,
    `Aktive Clock-Sessions: ${diagnostics.stats.activeClockCount}`,
    `Offene Vorfaelle: ${diagnostics.stats.openIncidentCount}`,
    `Aktive Voice-Raeume: ${diagnostics.stats.activeVoiceRoomCount}`
  ].join("\n");
};
