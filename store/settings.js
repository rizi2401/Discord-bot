const DEFAULT_RAW_SETTINGS = {
  adminRoleIds: "",
  botToWebsiteSecret: "",
  checkinGraceMinutes: "15",
  checkoutGraceMinutes: "30",
  headModChannelId: "",
  headModRoleId: "",
  incidentLogChannelId: "",
  joinLeaveLogChannelId: "",
  leadershipRoleIds: "",
  memberRoleId: "",
  onboardingRoleId: "",
  reminderChannelId: "",
  reminderMinutesBefore: "1440,60,15",
  rulesChannelId: "",
  shiftLogChannelId: "",
  supportRoleIds: "",
  teamSummaryIntro: "Es gibt neue oder geaenderte Schichten.",
  ticketCategoryId: "",
  ticketLogChannelId: "",
  verificationLogChannelId: "",
  verifyPanelChannelId: "",
  voiceCategoryId: "",
  voiceLogChannelId: "",
  voicePanelChannelId: "",
  voiceRoomIdleMinutes: "10",
  websiteBaseUrl: "",
  websiteClockEventPath: "/api/bot/clock-events",
  websiteToBotSecret: "",
  welcomeChannelId: ""
};

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseIdList = (value) => {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseReminderMinutes = (value, fallback) => {
  const parsed = String(value ?? "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((left, right) => right - left);

  return parsed.length > 0 ? parsed : fallback;
};

export const buildEffectiveSettings = ({ config, storedSettings = {} }) => {
  const raw = {
    ...DEFAULT_RAW_SETTINGS,
    timezone: config.timezone,
    reminderMinutesBefore: config.reminderMinutesBefore.join(","),
    checkinGraceMinutes: String(config.checkinGraceMinutes),
    checkoutGraceMinutes: String(config.checkoutGraceMinutes),
    voiceRoomIdleMinutes: String(config.voiceRoomIdleMinutes),
    websiteToBotSecret: config.websiteToBotSecret,
    botToWebsiteSecret: config.botToWebsiteSecret,
    ...storedSettings
  };

  return {
    raw,
    adminRoleIds: parseIdList(raw.adminRoleIds),
    botToWebsiteSecret: raw.botToWebsiteSecret,
    checkinGraceMinutes: parseInteger(raw.checkinGraceMinutes, config.checkinGraceMinutes),
    checkoutGraceMinutes: parseInteger(raw.checkoutGraceMinutes, config.checkoutGraceMinutes),
    headModChannelId: raw.headModChannelId,
    headModRoleId: raw.headModRoleId,
    incidentLogChannelId: raw.incidentLogChannelId,
    joinLeaveLogChannelId: raw.joinLeaveLogChannelId,
    leadershipRoleIds: parseIdList(raw.leadershipRoleIds),
    memberRoleId: raw.memberRoleId,
    onboardingRoleId: raw.onboardingRoleId,
    reminderChannelId: raw.reminderChannelId,
    reminderMinutesBefore: parseReminderMinutes(
      raw.reminderMinutesBefore,
      config.reminderMinutesBefore
    ),
    rulesChannelId: raw.rulesChannelId,
    shiftLogChannelId: raw.shiftLogChannelId,
    supportRoleIds: parseIdList(raw.supportRoleIds),
    teamSummaryIntro: raw.teamSummaryIntro,
    ticketCategoryId: raw.ticketCategoryId,
    ticketLogChannelId: raw.ticketLogChannelId,
    verificationLogChannelId: raw.verificationLogChannelId,
    verifyPanelChannelId: raw.verifyPanelChannelId,
    voiceCategoryId: raw.voiceCategoryId,
    voiceLogChannelId: raw.voiceLogChannelId,
    voicePanelChannelId: raw.voicePanelChannelId,
    voiceRoomIdleMinutes: parseInteger(raw.voiceRoomIdleMinutes, config.voiceRoomIdleMinutes),
    websiteBaseUrl: raw.websiteBaseUrl.replace(/\/+$/, ""),
    websiteClockEventPath: raw.websiteClockEventPath || "/api/bot/clock-events",
    websiteToBotSecret: raw.websiteToBotSecret,
    welcomeChannelId: raw.welcomeChannelId
  };
};

export const SETTINGS_FORM_FIELDS = [
  "welcomeChannelId",
  "rulesChannelId",
  "verifyPanelChannelId",
  "memberRoleId",
  "onboardingRoleId",
  "ticketCategoryId",
  "supportRoleIds",
  "leadershipRoleIds",
  "voiceCategoryId",
  "voicePanelChannelId",
  "reminderChannelId",
  "headModChannelId",
  "headModRoleId",
  "adminRoleIds",
  "joinLeaveLogChannelId",
  "verificationLogChannelId",
  "ticketLogChannelId",
  "voiceLogChannelId",
  "shiftLogChannelId",
  "incidentLogChannelId",
  "reminderMinutesBefore",
  "checkinGraceMinutes",
  "checkoutGraceMinutes",
  "voiceRoomIdleMinutes",
  "websiteBaseUrl",
  "websiteClockEventPath",
  "teamSummaryIntro"
];

export const SECRET_FORM_FIELDS = ["websiteToBotSecret", "botToWebsiteSecret"];
