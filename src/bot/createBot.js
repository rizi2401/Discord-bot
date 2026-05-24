import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes
} from "discord.js";
import { buildApplicationCommands } from "./registerCommands.js";
import { buildEffectiveSettings } from "../store/settings.js";
import {
  buildBotStatusLines,
  buildIncidentMessage,
  buildShiftChangeDm,
  buildShiftListLine,
  buildShiftReminderMessage,
  buildTeamShiftSummary,
  buildTicketIntro,
  buildTicketPanelContent,
  buildVerifyPanelContent,
  buildVoicePanelContent,
  buildWelcomeMessage
} from "../services/messages.js";

const TICKET_CREATE_BUTTON = "ticket|create";
const TICKET_CLAIM_BUTTON = "ticket|claim";
const TICKET_CLOSE_BUTTON = "ticket|close";
const VERIFY_BUTTON = "verify|confirm";
const VOICE_CREATE_BUTTON = "voice|create";
const CLOCK_PREFIX = "clock";
const DISCORD_LINK_REQUEST_TTL_MS = 1000 * 60 * 20;

const GENERAL_CRITICAL_SETTINGS = [
  "welcomeChannelId",
  "rulesChannelId",
  "memberRoleId",
  "ticketCategoryId",
  "voiceCategoryId"
];

const SHIFT_CRITICAL_SETTINGS = ["headModChannelId", "headModRoleId", "reminderChannelId"];

const buildClockButtonRow = (shiftId, action) => {
  const label = action === "in" ? "Jetzt einstempeln" : "Jetzt ausstempeln";
  const style = action === "in" ? ButtonStyle.Success : ButtonStyle.Primary;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CLOCK_PREFIX}|${action}|${shiftId}`)
        .setLabel(label)
        .setStyle(style)
    )
  ];
};

const buildTicketButtons = () => {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_CLAIM_BUTTON)
        .setLabel("Ticket claimen")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(TICKET_CLOSE_BUTTON)
        .setLabel("Ticket schliessen")
        .setStyle(ButtonStyle.Danger)
    )
  ];
};

const buildPanelButtons = (kind) => {
  if (kind === "verify") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(VERIFY_BUTTON)
          .setLabel("Regeln bestaetigen")
          .setStyle(ButtonStyle.Success)
      )
    ];
  }

  if (kind === "tickets") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(TICKET_CREATE_BUTTON)
          .setLabel("Ticket erstellen")
          .setStyle(ButtonStyle.Primary)
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(VOICE_CREATE_BUTTON)
        .setLabel("Privaten Voice-Raum erstellen")
        .setStyle(ButtonStyle.Primary)
    )
  ];
};

const buildUserChangeSummary = (changes) => {
  const lines = ["Es gab Aenderungen an deinen Schichten:"];

  for (const change of changes) {
    if (change.type === "removed") {
      lines.push(buildShiftChangeDm({ changeType: "removed", shift: change.shift }));
      continue;
    }

    if (change.type === "updated") {
      lines.push(
        buildShiftChangeDm({
          changeType: "updated",
          previousShift: change.previousShift,
          shift: change.shift
        })
      );
      continue;
    }

    lines.push(buildShiftChangeDm({ changeType: "created", shift: change.shift }));
  }

  return lines.join("\n\n");
};

const hasManagerPermission = (member) => {
  return (
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions.has(PermissionsBitField.Flags.ManageChannels)
  );
};

const normalizeInteractionReply = (interaction, payload) => {
  const normalized = typeof payload === "string" ? { content: payload } : { ...payload };

  if (interaction.inGuild()) {
    normalized.ephemeral ??= true;
  }

  return normalized;
};

const shiftBelongsToActor = (shift, actor) => {
  return (
    (actor.discordUserId && shift.discordUserId === actor.discordUserId) ||
    (actor.sonaraUserId && shift.sonaraUserId === actor.sonaraUserId)
  );
};

export const createBot = ({ config, database }) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel]
  });

  let settingsCache = null;

  const invalidateSettings = () => {
    settingsCache = null;
  };

  const getSettings = async () => {
    if (!settingsCache) {
      settingsCache = buildEffectiveSettings({
        config,
        storedSettings: await database.getAllSettings()
      });
    }

    return settingsCache;
  };

  const getMissingSettings = async () => {
    const settings = await getSettings();
    const requiredKeys = [...GENERAL_CRITICAL_SETTINGS, ...SHIFT_CRITICAL_SETTINGS];

    return requiredKeys.filter((key) => !settings[key]);
  };

  const fetchGuild = async () => {
    return client.guilds.fetch(config.guildId);
  };

  const fetchGuildMember = async (userId) => {
    const guild = await fetchGuild();
    return guild.members.fetch(userId);
  };

  const fetchTextChannel = async (channelId) => {
    if (!channelId) {
      return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  };

  const canManageTickets = async (userId) => {
    const settings = await getSettings();
    const member = await fetchGuildMember(userId).catch(() => null);

    if (!member) {
      return false;
    }

    if (hasManagerPermission(member)) {
      return true;
    }

    const allowedRoleIds = new Set([
      ...settings.adminRoleIds,
      ...settings.supportRoleIds,
      ...settings.leadershipRoleIds,
      settings.headModRoleId
    ]);

    return member.roles.cache.some((role) => allowedRoleIds.has(role.id));
  };

  const logToChannel = async (channelId, content) => {
    const channel = await fetchTextChannel(channelId);
    if (!channel) {
      return false;
    }

    await channel.send({ content });
    return true;
  };

  const logEvent = async (type, content) => {
    const settings = await getSettings();
    const channelByType = {
      incident: settings.incidentLogChannelId,
      join: settings.joinLeaveLogChannelId,
      shift: settings.shiftLogChannelId,
      ticket: settings.ticketLogChannelId,
      verification: settings.verificationLogChannelId,
      voice: settings.voiceLogChannelId
    };

    await logToChannel(channelByType[type], content);
  };

  const notifyMissingDiscordLink = async (shift, reason) => {
    if (!shift.isReminderAudience) {
      return;
    }

    const settings = await getSettings();
    if (!settings.shiftLogChannelId) {
      return;
    }

    await logToChannel(
      settings.shiftLogChannelId,
      `Discord-ID fehlt fuer ${shift.moderatorName} (${shift.sonaraUserId || "ohne Sonara-ID"}) in Schicht ${shift.id}. ${reason}`
    );
  };

  const sendUserDm = async ({ userId, payload, fallbackChannelId, fallbackPrefix = "" }) => {
    if (!userId) {
      const fallbackChannel = await fetchTextChannel(fallbackChannelId);
      if (!fallbackChannel) {
        return { deliveredBy: "missing_discord_id", ok: false };
      }

      await fallbackChannel.send({
        ...payload,
        content: `${fallbackPrefix}${payload.content}`
      });

      return { deliveredBy: "fallback_channel", ok: true };
    }

    const user = await client.users.fetch(userId);

    try {
      await user.send(payload);
      return { deliveredBy: "dm", ok: true };
    } catch (error) {
      const fallbackChannel = await fetchTextChannel(fallbackChannelId);

      if (!fallbackChannel) {
        throw error;
      }

      await fallbackChannel.send({
        ...payload,
        content: `<@${userId}> ${payload.content}`
      });

      return { deliveredBy: "fallback_channel", ok: true };
    }
  };

  const notifyHeadModeration = async ({ incidentType, shift }) => {
    const settings = await getSettings();
    const prefix = settings.headModRoleId ? `<@&${settings.headModRoleId}> ` : "";
    await logToChannel(
      settings.headModChannelId,
      `${prefix}${buildIncidentMessage({ incidentType, shift })}`
    );
  };

  const getActorShiftList = async (actor, now) => {
    if (actor.sonaraUserId) {
      return database.listShiftsForSonaraUser(actor.sonaraUserId, new Date(now - 60 * 60 * 1000));
    }

    const shifts = await database.getUpcomingShifts(new Date(now - 60 * 60 * 1000));
    return shifts.filter((shift) => shift.discordUserId === actor.discordUserId);
  };

  const findShiftForActor = async ({ actor, mode, shiftId = "" }) => {
    const now = Date.now();
    const settings = await getSettings();

    if (shiftId) {
      const directShift = await database.getShiftById(shiftId);
      return directShift && shiftBelongsToActor(directShift, actor) ? directShift : null;
    }

    if (mode === "check_out") {
      const openSession = actor.sonaraUserId
        ? await database.getCurrentOpenSessionForSonaraUser(actor.sonaraUserId)
        : await database.getCurrentOpenSessionForDiscordUser(actor.discordUserId);

      if (openSession) {
        return database.getShiftById(openSession.shiftId);
      }
    }

    const shifts = await getActorShiftList(actor, now);

    return (
      shifts.find((shift) => {
        const startTime = Date.parse(shift.startsAt);
        const endTime = Date.parse(shift.endsAt);
        const earliestCheckIn = startTime - 60 * 60 * 1000;

        if (mode === "check_in") {
          return now >= earliestCheckIn && now <= endTime;
        }

        const latestCheckOut = endTime + settings.checkoutGraceMinutes * 60_000;
        return now >= startTime && now <= latestCheckOut;
      }) ?? null
    );
  };

  const handleCheckIn = async ({ interaction = null, shiftId = "", source, actor }) => {
    const shift = await findShiftForActor({
      actor,
      mode: "check_in",
      shiftId
    });

    if (!shift) {
      if (interaction) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Ich habe gerade keine passende Schicht zum Einstempeln fuer dich gefunden."
          )
        );
      }
      return { ok: false, reason: "shift_not_found" };
    }

    const existingSession = await database.getOpenClockSessionForShift(shift.id);
    const actorOpenSession = actor.sonaraUserId
      ? await database.getCurrentOpenSessionForSonaraUser(actor.sonaraUserId)
      : await database.getCurrentOpenSessionForDiscordUser(actor.discordUserId);

    if (existingSession) {
      if (interaction) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            `Du bist fuer die Schicht ${shift.id} bereits eingestempelt.`
          )
        );
      }
      return { ok: false, reason: "already_open", shift };
    }

    if (actorOpenSession && actorOpenSession.shiftId !== shift.id) {
      if (interaction) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Du bist bereits in einer anderen Schicht eingestempelt und musst dich dort erst ausstempeln."
          )
        );
      }
      return { ok: false, reason: "already_open_elsewhere", shift };
    }

    const occurredAt = new Date().toISOString();
    await database.createCheckIn({
      discordUserId: shift.discordUserId,
      occurredAt,
      shiftId: shift.id,
      shiftSnapshot: shift,
      sonaraUserId: shift.sonaraUserId,
      source
    });

    await logEvent(
      "shift",
      `Check-in: ${shift.moderatorName} (${shift.sonaraUserId || "ohne Sonara-ID"}) fuer Schicht ${shift.id} um ${occurredAt}`
    );

    if (interaction) {
      await interaction.reply(
        normalizeInteractionReply(
          interaction,
          `Du bist jetzt fuer ${shift.moderatorName}s Schicht eingestempelt.`
        )
      );
    }

    return { ok: true, occurredAt, shift };
  };

  const handleCheckOut = async ({ interaction = null, shiftId = "", source, actor }) => {
    const shift = await findShiftForActor({
      actor,
      mode: "check_out",
      shiftId
    });

    if (!shift) {
      if (interaction) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Ich habe gerade keine offene Schicht zum Ausstempeln fuer dich gefunden."
          )
        );
      }
      return { ok: false, reason: "shift_not_found" };
    }

    const session = await database.createCheckOut({
      occurredAt: new Date().toISOString(),
      shiftId: shift.id,
      source
    });

    if (!session) {
      if (interaction) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Du bist fuer diese Schicht noch nicht eingestempelt."
          )
        );
      }
      return { ok: false, reason: "not_open", shift };
    }

    await logEvent(
      "shift",
      `Check-out: ${shift.moderatorName} (${shift.sonaraUserId || "ohne Sonara-ID"}) fuer Schicht ${shift.id} um ${session.checkedOutAt}`
    );

    if (interaction) {
      await interaction.reply(
        normalizeInteractionReply(
          interaction,
          `Du bist jetzt fuer die Schicht ${shift.id} ausgestempelt.`
        )
      );
    }

    return { ok: true, session, shift };
  };

  const sendShiftNotification = async ({ shift, type }) => {
    const settings = await getSettings();
    const eventKey = type.startsWith("pre-") ? type : `dm-${type}`;

    if (!shift.isReminderAudience) {
      await database.markNotification(shift.id, eventKey, new Date());
      return false;
    }

    if (await database.hasNotification(shift.id, eventKey)) {
      return false;
    }

    const buttonRows =
      type === "start" && shift.requiresClocking
        ? buildClockButtonRow(shift.id, "in")
        : type === "end" && shift.requiresClocking
          ? buildClockButtonRow(shift.id, "out")
          : [];

    await sendUserDm({
      fallbackChannelId: settings.reminderChannelId,
      fallbackPrefix: `[${shift.moderatorName}] `,
      payload: {
        components: buttonRows,
        content: buildShiftReminderMessage({
          settings,
          shift,
          type: type.startsWith("pre-") ? "pre" : type
        })
      },
      userId: shift.discordUserId
    });

    if (!shift.discordUserId) {
      await notifyMissingDiscordLink(
        shift,
        "Reminder wurde deshalb nur ueber den Fallback-Kanal abgelegt."
      );
    }

    await database.markNotification(shift.id, eventKey, new Date());
    return true;
  };

  const notifyShiftChanges = async (changes) => {
    const settings = await getSettings();
    const routes = new Map((await database.listTeamRoutes()).map((route) => [route.teamKey, route]));
    const userGrouped = new Map();
    const teamGrouped = new Map();

    const registerChange = (type, shift, previousShift = null) => {
      if (shift.isReminderAudience && shift.discordUserId) {
        const userChanges = userGrouped.get(shift.discordUserId) ?? [];
        userChanges.push({ previousShift, shift, type });
        userGrouped.set(shift.discordUserId, userChanges);
      }

      if (shift.teamKey) {
        const teamChanges = teamGrouped.get(shift.teamKey) ?? [];
        teamChanges.push({ previousShift, shift, type });
        teamGrouped.set(shift.teamKey, teamChanges);
      }
    };

    changes.created.forEach((shift) => registerChange("created", shift));
    changes.updated.forEach((item) => registerChange("updated", item.current, item.previous));
    changes.removed.forEach((shift) => registerChange("removed", shift));

    for (const shift of [...changes.created, ...changes.removed, ...changes.updated.map((item) => item.current)]) {
      if (shift.isReminderAudience && !shift.discordUserId) {
        await notifyMissingDiscordLink(
          shift,
          "Aenderungen konnten nicht per DM zugestellt werden."
        );
      }
    }

    for (const [discordUserId, userChanges] of userGrouped.entries()) {
      await sendUserDm({
        fallbackChannelId: settings.reminderChannelId,
        payload: {
          content: buildUserChangeSummary(userChanges)
        },
        userId: discordUserId
      }).catch(() => null);
    }

    for (const [teamKey, teamChanges] of teamGrouped.entries()) {
      const route = routes.get(teamKey);
      if (!route?.channelId) {
        continue;
      }

      await logToChannel(
        route.channelId,
        buildTeamShiftSummary({
          changes: teamChanges,
          introText: settings.teamSummaryIntro,
          route,
          teamKey
        })
      ).catch(() => null);
    }
  };

  const refreshTrackedShifts = async () => {
    const result = await database.syncSourceShifts(new Date());
    invalidateSettings();
    const totalChanges =
      result.changes.created.length +
      result.changes.updated.length +
      result.changes.removed.length;

    if (totalChanges > 0) {
      await notifyShiftChanges(result.changes);
    }

    return result;
  };

  const createTicket = async ({ creatorId, sourceInteraction = null }) => {
    const settings = await getSettings();
    if (!settings.ticketCategoryId) {
      if (sourceInteraction) {
        await sourceInteraction.reply(
          normalizeInteractionReply(
            sourceInteraction,
            "Das Ticketsystem ist noch nicht komplett konfiguriert."
          )
        );
      }
      return null;
    }

    const existingTicket = await database.getOpenTicketByCreator(creatorId);
    if (existingTicket) {
      const content = `Du hast bereits ein offenes Ticket: <#${existingTicket.channelId}>`;
      if (sourceInteraction) {
        await sourceInteraction.reply(normalizeInteractionReply(sourceInteraction, content));
      }
      return existingTicket;
    }

    const guild = await fetchGuild();
    const roleIds = new Set(
      [...settings.supportRoleIds, ...settings.leadershipRoleIds, ...settings.adminRoleIds, settings.headModRoleId].filter(Boolean)
    );

    const permissionOverwrites = [
      {
        deny: [PermissionFlagsBits.ViewChannel],
        id: guild.id
      },
      {
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ],
        id: creatorId
      }
    ];

    for (const roleId of roleIds) {
      permissionOverwrites.push({
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ],
        id: roleId
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${creatorId.slice(-4)}`,
      parent: settings.ticketCategoryId,
      permissionOverwrites,
      topic: `Support-Ticket fuer ${creatorId}`,
      type: ChannelType.GuildText
    });

    const ticket = await database.createTicket({
      channelId: channel.id,
      creatorId
    });

    await channel.send({
      components: buildTicketButtons(),
      content: buildTicketIntro(creatorId)
    });

    await logEvent("ticket", `Ticket erstellt: <#${channel.id}> von <@${creatorId}>`);

    if (sourceInteraction) {
      await sourceInteraction.reply(
        normalizeInteractionReply(sourceInteraction, `Dein Ticket wurde erstellt: <#${channel.id}>`)
      );
    }

    return ticket;
  };

  const createVoiceRoom = async ({ ownerId, sourceInteraction = null }) => {
    const settings = await getSettings();
    if (!settings.voiceCategoryId) {
      if (sourceInteraction) {
        await sourceInteraction.reply(
          normalizeInteractionReply(
            sourceInteraction,
            "Die Voice-Raum-Funktion ist noch nicht komplett konfiguriert."
          )
        );
      }
      return null;
    }

    const existingRoom = await database.getLatestOwnedVoiceRoom(ownerId);
    if (existingRoom) {
      const existingChannel = await client.channels.fetch(existingRoom.channelId).catch(() => null);
      if (existingChannel) {
        if (sourceInteraction) {
          await sourceInteraction.reply(
            normalizeInteractionReply(
              sourceInteraction,
              `Du hast bereits einen privaten Voice-Raum: <#${existingChannel.id}>`
            )
          );
        }
        return existingRoom;
      }

      await database.deleteVoiceRoom(existingRoom.channelId);
    }

    const guild = await fetchGuild();
    const visibleAdminRoleIds = new Set([...settings.adminRoleIds, settings.headModRoleId].filter(Boolean));

    const permissionOverwrites = [
      {
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        id: guild.id
      },
      {
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.UseVAD,
          PermissionFlagsBits.Stream
        ],
        id: ownerId
      }
    ];

    for (const roleId of visibleAdminRoleIds) {
      permissionOverwrites.push({
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.ManageChannels
        ],
        id: roleId
      });
    }

    const channel = await guild.channels.create({
      name: `Privat ${ownerId.slice(-4)}`,
      parent: settings.voiceCategoryId,
      permissionOverwrites,
      type: ChannelType.GuildVoice
    });

    await database.createVoiceRoom({
      channelId: channel.id,
      ownerId
    });

    const member = await fetchGuildMember(ownerId).catch(() => null);
    if (member?.voice.channel) {
      await member.voice.setChannel(channel).catch(() => null);
    }

    await logEvent("voice", `Privater Voice-Raum erstellt: <#${channel.id}> fuer <@${ownerId}>`);

    if (sourceInteraction) {
      await sourceInteraction.reply(
        normalizeInteractionReply(
          sourceInteraction,
          `Dein privater Voice-Raum ist bereit: <#${channel.id}>`
        )
      );
    }

    return database.getVoiceRoom(channel.id);
  };

  const cleanupVoiceRooms = async () => {
    const settings = await getSettings();
    const cutoff = new Date(Date.now() - settings.voiceRoomIdleMinutes * 60_000);
    const staleRooms = await database.listStaleVoiceRooms(cutoff);

    for (const room of staleRooms) {
      const channel = await client.channels.fetch(room.channelId).catch(() => null);
      if (channel?.isVoiceBased() && channel.members.size > 0) {
        await database.clearVoiceRoomEmpty(room.channelId);
        continue;
      }

      if (channel) {
        await channel.delete("Temporarer Voice-Raum automatisch aufgeraeumt").catch(() => null);
      }

      await database.deleteVoiceRoom(room.channelId);
      await logEvent("voice", `Privater Voice-Raum entfernt: ${room.channelId}`);
    }
  };

  const runReminderCycle = async () => {
    const settings = await getSettings();
    const shifts = await database.getUpcomingShifts();
    const now = Date.now();

    for (const shift of shifts) {
      const startTime = Date.parse(shift.startsAt);
      const endTime = Date.parse(shift.endsAt);

      if (shift.isReminderAudience) {
        for (const minutesBefore of settings.reminderMinutesBefore) {
          const eventKey = `pre-${minutesBefore}`;
          const reminderAt = startTime - minutesBefore * 60_000;
          if (await database.hasNotification(shift.id, eventKey)) {
            continue;
          }

          if (now >= startTime) {
            await database.markNotification(shift.id, eventKey, new Date());
            continue;
          }

          if (
            now >= reminderAt &&
            now < startTime
          ) {
            await sendShiftNotification({ shift, type: eventKey });
          }
        }

        const startReminderExpiresAt = startTime + settings.checkinGraceMinutes * 60_000;
        if (
          now >= startTime &&
          now <= startReminderExpiresAt &&
          !(await database.hasNotification(shift.id, "dm-start"))
        ) {
          await sendShiftNotification({ shift, type: "start" });
        } else if (
          now > startReminderExpiresAt &&
          !(await database.hasNotification(shift.id, "dm-start"))
        ) {
          await database.markNotification(shift.id, "dm-start", new Date());
        }

        if (
          now >= endTime &&
          now <= endTime + 120_000 &&
          !(await database.hasNotification(shift.id, "dm-end"))
        ) {
          await sendShiftNotification({ shift, type: "end" });
        }
      }

      if (!shift.requiresClocking) {
        continue;
      }

      const openSession = await database.getOpenClockSessionForShift(shift.id);
      const latestSession = await database.getLatestClockSessionForShift(shift.id);
      const noShowDueAt = startTime + settings.checkinGraceMinutes * 60_000;
      const checkoutMissedDueAt = endTime + settings.checkoutGraceMinutes * 60_000;

      if (!latestSession && now >= noShowDueAt && !(await database.findOpenIncident(shift.id, "no_show"))) {
        const incident = await database.createIncident({
          discordUserId: shift.discordUserId,
          metadata: {
            checked: "auto",
            phase: "check_in"
          },
          shiftId: shift.id,
          sonaraUserId: shift.sonaraUserId,
          type: "no_show"
        });

        await notifyHeadModeration({ incidentType: "no_show", shift });
        await logEvent("incident", `No-Show erkannt fuer ${shift.moderatorName} in Schicht ${shift.id}`);
        if (!shift.discordUserId) {
          await notifyMissingDiscordLink(
            shift,
            `No-Show wurde um ${incident.createdAt} erkannt.`
          );
        }
      }

      if (
        openSession &&
        now >= checkoutMissedDueAt &&
        !(await database.findOpenIncident(shift.id, "checkout_missed"))
      ) {
        const incident = await database.createIncident({
          discordUserId: shift.discordUserId,
          metadata: {
            checked: "auto",
            phase: "check_out"
          },
          shiftId: shift.id,
          sonaraUserId: shift.sonaraUserId,
          type: "checkout_missed"
        });

        await notifyHeadModeration({ incidentType: "checkout_missed", shift });
        await logEvent(
          "incident",
          `Fehlendes Ausstempeln erkannt fuer ${shift.moderatorName} in Schicht ${shift.id}`
        );
        if (!shift.discordUserId) {
          await notifyMissingDiscordLink(
            shift,
            `Fehlendes Ausstempeln wurde um ${incident.createdAt} erkannt.`
          );
        }
      }
    }
  };

  const postPanel = async ({ interaction, type }) => {
    const contentByType = {
      tickets: buildTicketPanelContent(),
      verify: buildVerifyPanelContent(),
      voice: buildVoicePanelContent()
    };

    const panelContent = contentByType[type];
    if (!panelContent) {
      await interaction.reply(normalizeInteractionReply(interaction, "Unbekannter Panel-Typ."));
      return;
    }

    await interaction.channel.send({
      components: buildPanelButtons(type),
      content: panelContent.content
    });

    await interaction.reply(normalizeInteractionReply(interaction, `Das ${type}-Panel wurde gepostet.`));
  };

  const handleCommand = async (interaction) => {
    if (interaction.commandName === "meine-schichten") {
      const userShifts = (await database.getUpcomingShifts())
        .filter((shift) => shift.discordUserId === interaction.user.id)
        .slice(0, 10);

      const content =
        userShifts.length > 0
          ? ["Deine kommenden Schichten:", ...userShifts.map(buildShiftListLine)].join("\n")
          : "Fuer dich ist aktuell keine kommende Schicht eingetragen.";

      await interaction.reply(normalizeInteractionReply(interaction, content));
      return;
    }

    if (interaction.commandName === "verknuepfen") {
      if (!config.botBaseUrl) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Die Web-Adresse des Bot-Hubs ist noch nicht gesetzt. Bitte gib dem Admin Bescheid."
          )
        );
        return;
      }

      const request = await database.createDiscordLinkRequest({
        discordName: interaction.user.username,
        discordUserId: interaction.user.id,
        expiresAt: new Date(Date.now() + DISCORD_LINK_REQUEST_TTL_MS),
        guildId: interaction.guildId ?? ""
      });
      const linkUrl = `${config.botBaseUrl}/hub/discord-link?token=${encodeURIComponent(request.token)}`;

      await interaction.reply(
        normalizeInteractionReply(
          interaction,
          [
            "Dein Verknuepfungs-Link ist bereit.",
            `Oeffne ihn innerhalb der naechsten 20 Minuten: ${linkUrl}`,
            "Danach meldest du dich mit deinem Sonara-Konto an und bestaetigst die Verknuepfung."
          ].join("\n")
        )
      );
      return;
    }

    if (interaction.commandName === "einstempeln") {
      await handleCheckIn({
        actor: { discordUserId: interaction.user.id },
        interaction,
        source: "discord_slash_command"
      });
      return;
    }

    if (interaction.commandName === "ausstempeln") {
      await handleCheckOut({
        actor: { discordUserId: interaction.user.id },
        interaction,
        source: "discord_slash_command"
      });
      return;
    }

    if (interaction.commandName === "ticket") {
      await createTicket({
        creatorId: interaction.user.id,
        sourceInteraction: interaction
      });
      return;
    }

    if (interaction.commandName === "raum-einladen") {
      const ownedRoom = await database.getLatestOwnedVoiceRoom(interaction.user.id);
      if (!ownedRoom) {
        await interaction.reply(
          normalizeInteractionReply(interaction, "Du hast aktuell keinen privaten Voice-Raum.")
        );
        return;
      }

      const invitedUser = interaction.options.getUser("nutzer", true);
      const channel = await client.channels.fetch(ownedRoom.channelId).catch(() => null);
      if (!channel?.isVoiceBased()) {
        await database.deleteVoiceRoom(ownedRoom.channelId);
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Dein gespeicherter Voice-Raum existiert nicht mehr. Bitte erstelle einen neuen."
          )
        );
        return;
      }

      await channel.permissionOverwrites.edit(invitedUser.id, {
        Connect: true,
        Speak: true,
        Stream: true,
        UseVAD: true,
        ViewChannel: true
      });

      const invitedUserIds = new Set([...(ownedRoom.invitedUserIds ?? []), invitedUser.id]);
      await database.setVoiceRoomInvites(ownedRoom.channelId, [...invitedUserIds]);

      await interaction.reply(
        normalizeInteractionReply(
          interaction,
          `<@${invitedUser.id}> wurde zu deinem privaten Voice-Raum eingeladen.`
        )
      );
      return;
    }

    if (interaction.commandName === "raum-schliessen") {
      const ownedRoom = await database.getLatestOwnedVoiceRoom(interaction.user.id);
      if (!ownedRoom) {
        await interaction.reply(
          normalizeInteractionReply(interaction, "Du hast aktuell keinen privaten Voice-Raum.")
        );
        return;
      }

      const channel = await client.channels.fetch(ownedRoom.channelId).catch(() => null);
      if (channel) {
        await channel.delete("Privater Voice-Raum vom Besitzer geschlossen").catch(() => null);
      }

      await database.deleteVoiceRoom(ownedRoom.channelId);
      await logEvent("voice", `Privater Voice-Raum manuell geschlossen: ${ownedRoom.channelId}`);
      await interaction.reply(
        normalizeInteractionReply(interaction, "Dein privater Voice-Raum wurde geschlossen.")
      );
      return;
    }

    if (interaction.commandName === "bot-status") {
      const diagnostics = await runtime.getDiagnostics();
      await interaction.reply(
        normalizeInteractionReply(interaction, buildBotStatusLines({ diagnostics }))
      );
      return;
    }

    if (interaction.commandName === "test-benachrichtigung") {
      const type = interaction.options.getString("typ", true);
      if (type === "dm") {
        const settings = await getSettings();
        await sendUserDm({
          fallbackChannelId: settings.reminderChannelId,
          payload: {
            content: "Dies ist eine Test-DM des Operations-Bots."
          },
          userId: interaction.user.id
        });
        await interaction.reply(
          normalizeInteractionReply(interaction, "Die Test-DM wurde gesendet.")
        );
        return;
      }

      if (type === "incident") {
        const settings = await getSettings();
        await logToChannel(
          settings.headModChannelId,
          `${settings.headModRoleId ? `<@&${settings.headModRoleId}> ` : ""}Test: Dies ist eine simulierte Head-Mod-Benachrichtigung.`
        );
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Die Incident-Testbenachrichtigung wurde gesendet."
          )
        );
        return;
      }

      const routes = await database.listTeamRoutes();
      const teamKey = interaction.options.getString("team_key") || routes[0]?.teamKey;
      const route = routes.find((item) => item.teamKey === teamKey);
      if (!route?.channelId) {
        await interaction.reply(
          normalizeInteractionReply(
            interaction,
            "Es gibt keinen konfigurierten Team-Route-Eintrag fuer diesen Test."
          )
        );
        return;
      }

      await logToChannel(
        route.channelId,
        buildTeamShiftSummary({
          changes: [
            {
              shift: {
                discordUserId: interaction.user.id,
                moderatorName: interaction.user.username,
                startsAt: new Date(Date.now() + 3600_000).toISOString(),
                teamKey,
                id: "test-shift"
              },
              type: "created"
            }
          ],
          introText: "Dies ist eine Team-Testbenachrichtigung.",
          route,
          teamKey
        })
      );

      await interaction.reply(
        normalizeInteractionReply(interaction, "Die Team-Testbenachrichtigung wurde gesendet.")
      );
      return;
    }

    if (interaction.commandName === "panel-posten") {
      await postPanel({
        interaction,
        type: interaction.options.getString("typ", true)
      });
    }
  };

  const handleButtonInteraction = async (interaction) => {
    const [scope, action, argument] = interaction.customId.split("|");

    if (scope === "verify" && action === "confirm") {
      const settings = await getSettings();
      if (!interaction.inGuild()) {
        await interaction.reply({ content: "Die Verifizierung funktioniert nur im Serverkontext." });
        return;
      }

      const member = await fetchGuildMember(interaction.user.id);
      if (settings.memberRoleId) {
        await member.roles.add(settings.memberRoleId).catch(() => null);
      }
      if (settings.onboardingRoleId) {
        await member.roles.remove(settings.onboardingRoleId).catch(() => null);
      }

      await logEvent("verification", `Verifizierung abgeschlossen: <@${interaction.user.id}>`);
      await interaction.reply(
        normalizeInteractionReply(
          interaction,
          "Danke, du bist jetzt verifiziert und hast deine Mitgliederrolle erhalten."
        )
      );
      return;
    }

    if (scope === "ticket" && action === "create") {
      await createTicket({
        creatorId: interaction.user.id,
        sourceInteraction: interaction
      });
      return;
    }

    if (scope === "ticket" && action === "claim") {
      if (!interaction.channel) {
        return;
      }

      const canManage = await canManageTickets(interaction.user.id);
      if (!canManage) {
        await interaction.reply(
          normalizeInteractionReply(interaction, "Du darfst Tickets nicht claimen.")
        );
        return;
      }

      await database.claimTicket(interaction.channel.id, interaction.user.id);
      await logEvent("ticket", `Ticket geclaimt: <#${interaction.channel.id}> von <@${interaction.user.id}>`);
      await interaction.reply(
        normalizeInteractionReply(
          interaction,
          `Dieses Ticket ist jetzt auf <@${interaction.user.id}> gesetzt.`
        )
      );
      return;
    }

    if (scope === "ticket" && action === "close") {
      if (!interaction.channel) {
        return;
      }

      const ticket = await database.getTicketByChannel(interaction.channel.id);
      const canManage = await canManageTickets(interaction.user.id);
      if (!ticket || (!canManage && ticket.creatorId !== interaction.user.id)) {
        await interaction.reply(
          normalizeInteractionReply(interaction, "Du darfst dieses Ticket nicht schliessen.")
        );
        return;
      }

      await database.closeTicket(interaction.channel.id, interaction.user.id, new Date());
      await logEvent("ticket", `Ticket geschlossen: <#${interaction.channel.id}> von <@${interaction.user.id}>`);
      await interaction.reply(
        normalizeInteractionReply(interaction, "Das Ticket wird jetzt geschlossen.")
      );
      setTimeout(() => {
        void interaction.channel.delete("Ticket geschlossen");
      }, 1500);
      return;
    }

    if (scope === "voice" && action === "create") {
      await createVoiceRoom({
        ownerId: interaction.user.id,
        sourceInteraction: interaction
      });
      return;
    }

    if (scope === CLOCK_PREFIX && action === "in") {
      await handleCheckIn({
        actor: { discordUserId: interaction.user.id },
        interaction,
        shiftId: argument,
        source: "discord_dm_button"
      });
      return;
    }

    if (scope === CLOCK_PREFIX && action === "out") {
      await handleCheckOut({
        actor: { discordUserId: interaction.user.id },
        interaction,
        shiftId: argument,
        source: "discord_dm_button"
      });
    }
  };

  const handleGuildMemberAdd = async (member) => {
    if (member.guild.id !== config.guildId) {
      return;
    }

    const settings = await getSettings();

    if (settings.onboardingRoleId) {
      await member.roles.add(settings.onboardingRoleId).catch(() => null);
    }

    await logToChannel(settings.welcomeChannelId, buildWelcomeMessage({ member, settings })).catch(
      () => null
    );
    await logEvent("join", `Neues Mitglied beigetreten: <@${member.id}>`);
  };

  const handleVoiceStateUpdate = async (oldState, newState) => {
    const oldRoom = oldState.channelId ? await database.getVoiceRoom(oldState.channelId) : null;
    if (oldRoom && oldState.channel?.members.size === 0) {
      await database.markVoiceRoomEmpty(oldState.channelId, new Date());
    }

    const newRoom = newState.channelId ? await database.getVoiceRoom(newState.channelId) : null;
    if (newRoom) {
      await database.clearVoiceRoomEmpty(newState.channelId);
    }
  };

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord bot connected as ${readyClient.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(config.discordToken);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: buildApplicationCommands()
    });

    console.log(`Registered slash commands for guild ${config.guildId}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }
    } catch (error) {
      console.error("Interaction handling failed:", error);
      const payload = normalizeInteractionReply(
        interaction,
        "Beim Bearbeiten deiner Anfrage ist ein Fehler aufgetreten."
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  });

  client.on(Events.GuildMemberAdd, (member) => {
    void handleGuildMemberAdd(member);
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void handleVoiceStateUpdate(oldState, newState);
  });

  const runtime = {
    async authenticateHubUser(login, password) {
      return database.authenticateSonaraUser(login, password);
    },
    async getDiagnostics() {
      const settings = await getSettings();
      return {
        missingSettings: await getMissingSettings(),
        settings,
        stats: await database.getDashboardStats(new Date())
      };
    },
    async getAdminHubData() {
      const settings = await getSettings();
      const shifts = await database.getUpcomingShifts();
      return {
        diagnostics: {
          missingSettings: await getMissingSettings(),
          settings,
          stats: await database.getDashboardStats(new Date())
        },
        notificationEvents: await database.listNotificationEventsForShifts(
          shifts.map((shift) => shift.id)
        ),
        settings,
        shifts,
        teamRoutes: await database.listTeamRoutes(),
        users: await database.listHubUsers()
      };
    },
    async getDiscordLinkRequest(token) {
      return database.getDiscordLinkRequest(token);
    },
    async getHubUser(userId) {
      return database.getHubUserById(userId);
    },
    async getModeratorHubData(userId) {
      const user = await database.getHubUserById(userId);
      if (!user) {
        return null;
      }

      const shifts = user.isModerator ? await database.listShiftsForSonaraUser(user.id) : [];
      const activeSession = user.isModerator
        ? await database.getCurrentOpenSessionForSonaraUser(user.id)
        : null;
      return {
        activeSession,
        shifts,
        user
      };
    },
    async confirmDiscordLink({ token, userId }) {
      const request = await database.getDiscordLinkRequest(token);
      if (!request) {
        return { ok: false, reason: "request_not_found" };
      }

      return database.completeDiscordLink({
        actorUserId: userId,
        discordName: request.discordName,
        discordUserId: request.discordUserId,
        token
      });
    },
    async getSettings() {
      return getSettings();
    },
    async importTrackedShifts(payload) {
      const result = await database.syncImportedShifts(payload);
      invalidateSettings();
      const totalChanges =
        result.changes.created.length +
        result.changes.updated.length +
        result.changes.removed.length;

      if (totalChanges > 0) {
        await notifyShiftChanges(result.changes);
      }

      return result;
    },
    async handleHubCheckIn({ shiftId = "", userId }) {
      const user = await database.getHubUserById(userId);
      if (!user) {
        return { message: "Dein Sonara-Konto wurde nicht mehr gefunden.", ok: false };
      }

      const result = await handleCheckIn({
        actor: {
          discordUserId: user.discordUserId,
          sonaraUserId: user.id
        },
        shiftId,
        source: "web_hub"
      });

      return result.ok
        ? {
            message: `Du bist jetzt fuer die Schicht ${result.shift.id} eingestempelt.`,
            ok: true
          }
        : {
            message:
              result.reason === "already_open"
                ? "Du bist fuer diese Schicht bereits eingestempelt."
                : result.reason === "already_open_elsewhere"
                  ? "Du bist bereits in einer anderen Schicht eingestempelt."
                : "Ich habe gerade keine passende Schicht zum Einstempeln gefunden.",
            ok: false
          };
    },
    async handleHubCheckOut({ shiftId = "", userId }) {
      const user = await database.getHubUserById(userId);
      if (!user) {
        return { message: "Dein Sonara-Konto wurde nicht mehr gefunden.", ok: false };
      }

      const result = await handleCheckOut({
        actor: {
          discordUserId: user.discordUserId,
          sonaraUserId: user.id
        },
        shiftId,
        source: "web_hub"
      });

      return result.ok
        ? {
            message: `Du bist jetzt fuer die Schicht ${result.shift.id} ausgestempelt.`,
            ok: true
          }
        : {
            message:
              result.reason === "not_open"
                ? "Du bist fuer diese Schicht noch nicht eingestempelt."
                : "Ich habe gerade keine offene Schicht zum Ausstempeln gefunden.",
            ok: false
          };
    },
    async setShiftDmPreference({ enabled, targetUserId, updatedBy }) {
      await database.setUserNotificationPreference({
        shiftDmEnabled: enabled,
        updatedBy,
        userId: targetUserId
      });
      return database.getHubUserById(targetUserId);
    },
    async unlinkDiscordIdentity({ targetUserId, updatedBy }) {
      return database.unlinkDiscordIdentity({
        actorUserId: updatedBy,
        sonaraUserId: targetUserId
      });
    },
    async refreshSettings() {
      invalidateSettings();
      return getSettings();
    },
    async refreshTrackedShifts() {
      return refreshTrackedShifts();
    },
    async runAutomationCycle() {
      await refreshTrackedShifts();
      await runReminderCycle();
      await cleanupVoiceRooms();
      await database.deleteExpiredDiscordLinkRequests(new Date());
      await database.deleteExpiredWebSessions(new Date());
    }
  };

  return { client, runtime };
};
