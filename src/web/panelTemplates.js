const escapeHtml = (value) => {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const formatDate = (value) => {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
};

const card = (label, value, helper = "") => {
  return `
    <div class="card">
      <div class="card-label">${escapeHtml(label)}</div>
      <div class="card-value">${escapeHtml(value)}</div>
      ${helper ? `<div class="card-helper">${escapeHtml(helper)}</div>` : ""}
    </div>
  `;
};

const textInput = ({ label, name, type = "text", value = "", placeholder = "" }) => {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="${escapeHtml(type)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />
    </label>
  `;
};

const textareaInput = ({ label, name, value = "" }) => {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeHtml(name)}">${escapeHtml(value)}</textarea>
    </label>
  `;
};

const routeRow = (route) => {
  return `
    <tr>
      <td>${escapeHtml(route.teamKey)}</td>
      <td>${escapeHtml(route.roleId || "-")}</td>
      <td>${escapeHtml(route.channelId || "-")}</td>
      <td>
        <form method="post" action="/hub/admin/team-routes/delete">
          <input type="hidden" name="teamKey" value="${escapeHtml(route.teamKey)}" />
          <input type="hidden" name="redirectTo" value="/hub/admin/advanced" />
          <button type="submit" class="danger">Entfernen</button>
        </form>
      </td>
    </tr>
  `;
};

const hubUserRow = (user) => {
  const discordState = user.hasDiscordLink
    ? [
        user.discordName ? `<strong>${escapeHtml(user.discordName)}</strong>` : "<strong>Discord</strong>",
        `<span class="muted">DM-ID:</span> ${user.discordUserId ? `<code>${escapeHtml(user.discordUserId)}</code>` : '<span class="warn-text">fehlt</span>'}`,
        `<span class="muted">Sonara:</span> ${user.sourceDiscordUserId ? `<code>${escapeHtml(user.sourceDiscordUserId)}</code>` : "-"}`,
        `<span class="muted">Bot-Link:</span> ${user.linkedDiscordUserId ? `<code>${escapeHtml(user.linkedDiscordUserId)}</code>` : "-"}`,
        user.hasDiscordSyncMismatch ? `<span class="pill">Sync-Mismatch</span>` : ""
      ]
        .filter(Boolean)
        .join("<br />")
    : '<span class="muted">nicht verknuepft</span>';

  const dmToggleLabel = user.shiftDmEnabled ? "Schicht-DMs deaktivieren" : "Schicht-DMs aktivieren";
  const dmToggleValue = user.shiftDmEnabled ? "false" : "true";
  const dmState = user.shiftDmEnabled ? "aktiv" : "deaktiviert";

  return `
    <tr>
      <td>
        <strong>${escapeHtml(user.displayName)}</strong><br />
        <span class="muted">${escapeHtml(user.loginName)}</span>
      </td>
      <td>${escapeHtml(user.roleNames.join(", ") || user.role || "-")}</td>
      <td>${discordState}</td>
      <td>${escapeHtml(dmState)}</td>
      <td>
        <div class="actions compact">
          <form method="post" action="/hub/admin/users/${encodeURIComponent(user.id)}/dm-preferences">
            <input type="hidden" name="shiftDmEnabled" value="${escapeHtml(dmToggleValue)}" />
            <button type="submit" class="secondary">${escapeHtml(dmToggleLabel)}</button>
          </form>
          ${
            user.hasDiscordLink
              ? `
                <form method="post" action="/hub/admin/users/${encodeURIComponent(user.id)}/unlink-discord">
                  <button type="submit" class="danger">Discord trennen</button>
                </form>
              `
              : ""
          }
        </div>
      </td>
    </tr>
  `;
};

const flash = (message, tone = "success") => {
  if (!message) {
    return "";
  }

  return `<div class="flash ${escapeHtml(tone)}">${escapeHtml(message)}</div>`;
};

const shell = ({ body, title }) => {
  return `
<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #081119;
        --panel: rgba(12, 23, 34, 0.9);
        --panel-2: rgba(17, 31, 46, 0.95);
        --line: #284058;
        --text: #f3f7fb;
        --muted: #95abc2;
        --accent: #6de6c2;
        --accent-2: #9dd0ff;
        --danger: #ff8d8d;
        --warning: #ffcf77;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--text);
        font-family: "Trebuchet MS", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(40, 84, 124, 0.35), transparent 40%),
          linear-gradient(180deg, #071018 0%, #0b1823 100%);
      }
      a { color: var(--accent-2); text-decoration: none; }
      code {
        background: rgba(255,255,255,0.06);
        border-radius: 8px;
        padding: 2px 8px;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 24px 18px 48px;
      }
      .hero, .panel, .notice, .flash {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--panel);
        box-shadow: 0 18px 40px rgba(0,0,0,0.22);
        margin-bottom: 18px;
      }
      .hero, .panel, .notice {
        padding: 22px;
      }
      .panel.compact {
        padding: 18px;
      }
      .hero h1, .panel h2, .panel h3 {
        margin-top: 0;
      }
      .hero p, .notice p, .muted {
        color: var(--muted);
      }
      .flash {
        padding: 14px 18px;
      }
      .flash.success { border-color: rgba(109, 230, 194, 0.45); }
      .flash.error { border-color: rgba(255, 141, 141, 0.55); }
      .flash.warn { border-color: rgba(255, 207, 119, 0.55); }
      .warn-text { color: var(--warning); }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
      }
      .nav-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .nav-card {
        display: block;
        min-height: 138px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel-2);
        padding: 16px;
        color: var(--text);
      }
      .nav-card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 18px;
      }
      .nav-card span {
        color: var(--muted);
      }
      .two-col {
        display: grid;
        grid-template-columns: 1.1fr 1fr;
        gap: 18px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel-2);
        padding: 14px;
      }
      .card-label {
        font-size: 13px;
        color: var(--muted);
        margin-bottom: 6px;
      }
      .card-value {
        font-size: 26px;
        font-weight: 700;
      }
      .card-helper {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
      }
      .field {
        display: block;
        margin-bottom: 14px;
      }
      .field span {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 14px;
      }
      input, textarea, button {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: #09141d;
        color: var(--text);
        padding: 12px 14px;
        font: inherit;
      }
      textarea {
        min-height: 110px;
        resize: vertical;
      }
      button {
        cursor: pointer;
        font-weight: 700;
        background: linear-gradient(135deg, var(--accent), #98f0d7);
        color: #052119;
      }
      button.secondary {
        background: #1a2d42;
        color: var(--text);
      }
      button.danger {
        background: var(--danger);
        color: #2b0d0d;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .actions.compact {
        gap: 8px;
      }
      .actions > * {
        flex: 1 1 180px;
      }
      .actions.compact > * {
        flex: 1 1 150px;
      }
      .toolbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
      }
      .pill {
        display: inline-block;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 7px 12px;
        margin-right: 8px;
        margin-bottom: 8px;
        color: var(--muted);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      .table-scroll {
        overflow-x: auto;
      }
      th, td {
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 13px;
      }
      .status-list {
        display: grid;
        gap: 10px;
      }
      .status-row {
        display: grid;
        grid-template-columns: minmax(150px, 1fr) minmax(180px, 2fr);
        gap: 10px;
        border-bottom: 1px solid var(--line);
        padding-bottom: 10px;
      }
      .status-row:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      .shift-list {
        display: grid;
        gap: 12px;
      }
      .shift-item {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel-2);
        padding: 14px;
      }
      .shift-item h3 {
        margin: 0 0 8px;
      }
      .shift-meta {
        color: var(--muted);
        margin-bottom: 8px;
      }
      .inline-form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      @media (max-width: 920px) {
        .two-col { grid-template-columns: 1fr; }
        .status-row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      ${body}
    </div>
  </body>
</html>
  `;
};

export const renderLoginPage = ({
  botName,
  errorMessage = "",
  introMessage = "",
  redirectTo = ""
}) => {
  const body = `
    <section class="hero">
      <h1>${escapeHtml(botName)}</h1>
      <p>Eigener Moderator- und Admin-Hub fuer Schichten, Clocking, Tickets, Welcome und Team-Automationen.</p>
    </section>
    ${flash(errorMessage, "error")}
    <section class="panel" style="max-width: 520px; margin-inline: auto;">
      <h2>Mit Sonara anmelden</h2>
      ${introMessage ? `<p class="muted">${escapeHtml(introMessage)}</p>` : ""}
      <p class="muted">Der Hub nutzt dieselben Zugangsdaten wie Sonara. Er akzeptiert den Sonara-Benutzernamen, den VRChat-Namen oder den Discord-Namen.</p>
      <form method="post" action="/auth/login">
        ${redirectTo ? `<input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}" />` : ""}
        ${textInput({ label: "Benutzername, VRChat-Name oder Discord-Name", name: "login", placeholder: "dein Sonara-Login" })}
        ${textInput({ label: "Passwort", name: "password", type: "password", placeholder: "dein Passwort" })}
        <button type="submit">Einloggen</button>
      </form>
    </section>
  `;

  return shell({ body, title: `${botName} Login` });
};

export const renderErrorPage = ({ actionHref = "/hub", actionLabel = "Zurueck", message, title }) => {
  const body = `
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <a href="${escapeHtml(actionHref)}"><button class="secondary">${escapeHtml(actionLabel)}</button></a>
      </div>
    </section>
  `;

  return shell({ body, title });
};

export const renderHubPage = ({
  activeSession,
  botName,
  flashMessage = "",
  flashTone = "success",
  shifts,
  user
}) => {
  const shiftMarkup = shifts.length
    ? shifts
        .map((shift) => {
          const actionMarkup = shift.canCheckOut
            ? `
              <form method="post" action="/hub/clock-out">
                <input type="hidden" name="shiftId" value="${escapeHtml(shift.id)}" />
                <button type="submit">Jetzt ausstempeln</button>
              </form>
            `
            : shift.canCheckIn
              ? `
                <form method="post" action="/hub/clock-in">
                  <input type="hidden" name="shiftId" value="${escapeHtml(shift.id)}" />
                  <button type="submit">Jetzt einstempeln</button>
                </form>
              `
              : shift.requiresClocking
                ? `<div class="pill">${escapeHtml(shift.clockHint)}</div>`
                : `<div class="pill">Nur Information, kein Clocking noetig</div>`;

          return `
            <article class="shift-item">
              <h3>${escapeHtml(shift.moderatorName)}</h3>
              <div class="shift-meta">${escapeHtml(shift.startsAtLabel)} bis ${escapeHtml(shift.endsAtLabel)}</div>
              <div class="shift-meta">Rolle/Team: ${escapeHtml(shift.teamKey || shift.userRole || "nicht gesetzt")}</div>
              ${shift.notes ? `<p>${escapeHtml(shift.notes)}</p>` : `<p class="muted">Keine Notiz zur Schicht hinterlegt.</p>`}
              <div class="actions">
                ${actionMarkup}
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="notice"><p>Fuer dich sind aktuell keine kommenden Schichten im Hub sichtbar.</p></div>`;

  const body = `
    <section class="hero">
      <div class="toolbar">
        <div>
          <h1>${escapeHtml(botName)} Moderator-Hub</h1>
          <p>Angemeldet als ${escapeHtml(user.displayName)} (${escapeHtml(user.loginName)})</p>
        </div>
        <div class="actions" style="min-width: 320px;">
          ${
            user.isAdmin
              ? `<a href="/hub/admin"><button class="secondary">Zum Admin-Bereich</button></a>`
              : ""
          }
          <form method="post" action="/auth/logout">
            <button type="submit" class="secondary">Abmelden</button>
          </form>
        </div>
      </div>
    </section>
    ${flash(flashMessage, flashTone)}
    ${
      !user.hasDiscordLink
        ? flash(
            "Dein Sonara-Konto ist noch nicht mit Discord verknuepft. Web-Clocking funktioniert weiter, aber fuer Schicht-DMs musst du zuerst /verknuepfen im Discord-Server nutzen.",
            "warn"
          )
        : !user.shiftDmEnabled
          ? flash(
              "Dein Discord-Konto ist verknuepft, aber Schicht-DMs sind fuer dein Sonara-Konto aktuell deaktiviert. Ein Admin kann das im Bot-Hub freischalten.",
              "warn"
            )
          : ""
    }
    <section class="panel">
      <div class="grid">
        ${card("Rollen", user.roleNames.join(", ") || "keine")}
        ${card("Discord-Verknuepfung", user.discordUserId || "fehlt", user.discordName || "Noch kein Discord-Konto verbunden")}
        ${card("Schicht-DMs", user.shiftDmEnabled ? "aktiv" : "deaktiviert", user.shiftDmEnabled ? "Erinnerungen und DM-Clocking sind fuer dein Konto freigeschaltet." : "Ein Admin kann die DMs pro Person an- oder ausschalten.")}
        ${card(
          "Aktive Session",
          activeSession ? "Ja" : "Nein",
          activeSession ? `Seit ${formatDate(activeSession.checkedInAt)}` : "Du bist aktuell nicht eingestempelt."
        )}
      </div>
    </section>
    <section class="panel">
      <h2>Deine kommenden Schichten</h2>
      <div class="shift-list">
        ${shiftMarkup}
      </div>
    </section>
  `;

  return shell({ body, title: `${botName} Moderator-Hub` });
};

export const renderDiscordLinkPage = ({
  botName,
  conflictUser = null,
  linkRequest,
  token,
  user
}) => {
  const conflictMarkup = conflictUser
    ? `
      ${flash(
        `Dieses Discord-Konto ist bereits mit ${conflictUser.displayName} (${conflictUser.loginName}) verknuepft. Bitte loese die alte Verknuepfung zuerst im Admin-Hub.`,
        "error"
      )}
    `
    : "";

  const body = `
    <section class="hero">
      <h1>${escapeHtml(botName)} Discord-Verknuepfung</h1>
      <p>Hier verbindest du das Discord-Konto aus deinem Slash-Command sicher mit deinem Sonara-Konto.</p>
    </section>
    ${conflictMarkup}
    <section class="panel">
      <div class="grid">
        ${card("Sonara-Konto", user.displayName, user.loginName)}
        ${card("Discord-Name", linkRequest.discordName || "unbekannt")}
        ${card("Discord-ID", linkRequest.discordUserId)}
        ${card("Gueltig bis", formatDate(linkRequest.expiresAt))}
      </div>
      <p class="muted" style="margin-top: 18px;">
        Nach der Bestätigung schreibt der Bot deine Discord-ID nach Sonara und in seine eigene Spiegelung. Dadurch koennen spaeter DMs und Clocking sauber zugestellt werden.
      </p>
      ${
        conflictUser
          ? `<div class="actions"><a href="/hub"><button class="secondary">Zum Login</button></a></div>`
          : `
            <form method="post" action="/hub/discord-link/confirm">
              <input type="hidden" name="token" value="${escapeHtml(token)}" />
              <div class="actions">
                <button type="submit">Discord jetzt verknuepfen</button>
              </div>
            </form>
          `
      }
    </section>
  `;

  return shell({ body, title: `${botName} Discord-Verknuepfung` });
};

const SETTING_LABELS = {
  adminRoleIds: "Admin-Rollen",
  checkinGraceMinutes: "Check-in-Frist",
  checkoutGraceMinutes: "Check-out-Frist",
  headModChannelId: "Head-Mod-Kanal",
  headModRoleId: "Head-Mod-Rolle",
  hubIntroText: "Text oben im Hub",
  incidentLogChannelId: "Vorfall-Log",
  joinLeaveLogChannelId: "Join/Leave-Log",
  leadershipRoleIds: "Leitungsrollen",
  memberRoleId: "Mitgliederrolle",
  onboardingRoleId: "Onboarding-Rolle",
  reminderChannelId: "Reminder-/Fallback-Kanal",
  reminderMinutesBefore: "Reminder vorher",
  rulesChannelId: "Regel-Kanal",
  shiftLogChannelId: "Schicht-/Clock-Log",
  supportRoleIds: "Support-Rollen",
  teamSummaryIntro: "Team-Benachrichtigung",
  ticketCategoryId: "Ticket-Kategorie",
  ticketLogChannelId: "Ticket-Log",
  verificationLogChannelId: "Verify-Log",
  verifyPanelChannelId: "Verify-Panel-Kanal",
  voiceCategoryId: "Voice-Kategorie",
  voiceLogChannelId: "Voice-Log",
  voicePanelChannelId: "Voice-Panel-Kanal",
  voiceRoomIdleMinutes: "Voice-Leerlauf"
};

const renderSettingField = ({ name, settings }) => {
  const value = settings.raw[name] ?? "";
  if (name === "hubIntroText" || name === "teamSummaryIntro") {
    return textareaInput({ label: SETTING_LABELS[name] ?? name, name, value });
  }

  return textInput({ label: SETTING_LABELS[name] ?? name, name, value });
};

const renderSettingsForm = ({ fields, redirectTo, settings, submitLabel }) => {
  return `
    <form method="post" action="/hub/admin/settings/general">
      <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}" />
      ${fields.map((name) => renderSettingField({ name, settings })).join("")}
      <button type="submit">${escapeHtml(submitLabel)}</button>
    </form>
  `;
};

const adminHeader = ({ botName, settings, user }) => {
  return `
    <section class="hero">
      <div class="toolbar">
        <div>
          <h1>${escapeHtml(botName)} Admin-Hub</h1>
          <p>${escapeHtml(settings.hubIntroText || "")}</p>
        </div>
        <div class="actions" style="min-width: 320px;">
          <a href="/hub"><button class="secondary">Moderator-Hub</button></a>
          <form method="post" action="/auth/logout">
            <button type="submit" class="secondary">Abmelden</button>
          </form>
        </div>
      </div>
      <div class="pill">Angemeldet als ${escapeHtml(user.displayName)}</div>
      <div class="pill">Letzter Source-Sync: ${escapeHtml(formatDate(settings.raw.lastSourceSyncAt))}</div>
    </section>
  `;
};

const adminNav = () => {
  return `
    <section class="panel compact">
      <div class="nav-grid">
        <a class="nav-card" href="/hub/admin/shifts">
          <strong>Schichten & DMs</strong>
          <span>Benutzer, Discord-Verknuepfungen, DM-Schalter und Reminder-Status.</span>
        </a>
        <a class="nav-card" href="/hub/admin/discord">
          <strong>Kanaele & Rollen</strong>
          <span>Die wichtigsten Discord-Ziele fuer Welcome, Regeln, Reminder und Leitung.</span>
        </a>
        <a class="nav-card" href="/hub/admin/advanced">
          <strong>Erweitert</strong>
          <span>Tickets, Voice, Logs, Team-Routing und technische Texte.</span>
        </a>
      </div>
    </section>
  `;
};

const missingSettingsNotice = (diagnostics) => {
  return diagnostics.missingSettings.length
    ? `
      <section class="notice">
        <h2>Offene Konfigurationsluecken</h2>
        <p>${escapeHtml(diagnostics.missingSettings.join(", "))}</p>
      </section>
    `
    : "";
};

const adminShell = ({
  botName,
  body,
  diagnostics,
  flashMessage = "",
  flashTone = "success",
  settings,
  title,
  user
}) => {
  return shell({
    body: `
      ${adminHeader({ botName, settings, user })}
      ${flash(flashMessage, flashTone)}
      ${missingSettingsNotice(diagnostics)}
      ${body}
    `,
    title: `${botName} ${title}`
  });
};

export const renderAdminPage = ({
  botName,
  diagnostics,
  flashMessage = "",
  flashTone = "success",
  settings,
  user
}) => {
  const body = `
    <section class="panel">
      <h2>Status</h2>
      <div class="grid">
        ${card("Kommende Schichten", diagnostics.stats.upcomingShiftCount)}
        ${card("Offene Tickets", diagnostics.stats.openTicketCount)}
        ${card("Aktive Clock-Sessions", diagnostics.stats.activeClockCount)}
        ${card("Offene Vorfaelle", diagnostics.stats.openIncidentCount)}
        ${card("Private Voice-Raeume", diagnostics.stats.activeVoiceRoomCount)}
      </div>
      <form method="post" action="/hub/admin/actions/refresh-shifts" style="margin-top: 16px;">
        <button type="submit" class="secondary">Sonara-Schichten jetzt neu einlesen</button>
      </form>
    </section>
    ${adminNav()}
  `;

  return adminShell({
    body,
    botName,
    diagnostics,
    flashMessage,
    flashTone,
    settings,
    title: "Admin-Hub",
    user
  });
};

const buildReminderStatusRows = ({ notificationEvents, settings, shifts }) => {
  const eventsByShift = new Map();
  for (const event of notificationEvents) {
    const events = eventsByShift.get(event.shiftId) ?? [];
    events.push(event);
    eventsByShift.set(event.shiftId, events);
  }

  const now = Date.now();
  return shifts.slice(0, 20).map((shift) => {
    const events = eventsByShift.get(shift.id) ?? [];
    const startTime = Date.parse(shift.startsAt);
    const nextReminder = settings.reminderMinutesBefore
      .map((minutes) => ({
        eventKey: `pre-${minutes}`,
        label: `${minutes} Min. vorher`,
        dueAt: startTime - minutes * 60_000
      }))
      .find((item) => !events.some((event) => event.eventKey === item.eventKey) && now < startTime);
    const latestEvent = events[0];

    return `
      <div class="status-row">
        <div>
          <strong>${escapeHtml(shift.moderatorName)}</strong><br />
          <span class="muted">${escapeHtml(formatDate(shift.startsAt))}</span>
        </div>
        <div>
          <div>${shift.discordUserId ? `DM-ID <code>${escapeHtml(shift.discordUserId)}</code>` : '<span class="warn-text">Discord-ID fehlt</span>'}</div>
          <div class="muted">Naechster Reminder: ${nextReminder ? `${escapeHtml(nextReminder.label)} (${escapeHtml(formatDate(nextReminder.dueAt))})` : "keiner offen"}</div>
          <div class="muted">Letzter Status: ${latestEvent ? `${escapeHtml(latestEvent.eventKey)} um ${escapeHtml(formatDate(latestEvent.sentAt))}` : "noch nichts gesendet"}</div>
        </div>
      </div>
    `;
  }).join("");
};

export const renderAdminShiftsPage = ({
  botName,
  diagnostics,
  flashMessage = "",
  flashTone = "success",
  notificationEvents,
  settings,
  shifts,
  user,
  users
}) => {
  const missingDiscordUsers = users.filter((item) => item.shiftDmEnabled && !item.discordUserId).length;
  const body = `
    ${adminNav()}
    <section class="panel">
      <h2>Schichten & DMs</h2>
      <div class="grid">
        ${card("DMs ohne Discord-ID", missingDiscordUsers)}
        ${card("Kommende Schichten", shifts.length)}
        ${card("Reminder", settings.raw.reminderMinutesBefore, "Minuten vor Schichtbeginn")}
      </div>
    </section>
    <section class="panel">
      <h2>Benutzer und Schicht-DMs</h2>
      <p class="muted">Die DM-ID ist die ID, die der Bot wirklich fuer Nachrichten nutzt. Bot-Link greift als Fallback, wenn Sonara leer ist.</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sonara</th>
              <th>Rolle</th>
              <th>Discord</th>
              <th>Schicht-DMs</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            ${users.length ? users.map(hubUserRow).join("") : "<tr><td colspan=\"5\">Noch keine Sonara-Nutzer gefunden.</td></tr>"}
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <h2>Reminder-Status</h2>
      <div class="status-list">
        ${shifts.length ? buildReminderStatusRows({ notificationEvents, settings, shifts }) : "<p class=\"muted\">Keine kommenden Schichten gefunden.</p>"}
      </div>
    </section>
  `;

  return adminShell({
    body,
    botName,
    diagnostics,
    flashMessage,
    flashTone,
    settings,
    title: "Schichten",
    user
  });
};

export const renderAdminDiscordPage = ({
  botName,
  diagnostics,
  flashMessage = "",
  flashTone = "success",
  settings,
  user
}) => {
  const body = `
    ${adminNav()}
    <section class="panel" style="max-width: 760px;">
      <h2>Kanaele & Rollen</h2>
      <p class="muted">Nur die wichtigsten Ziele fuer Betrieb, Regeln und Schichtmeldungen.</p>
      ${renderSettingsForm({
        fields: [
          "welcomeChannelId",
          "rulesChannelId",
          "memberRoleId",
          "reminderChannelId",
          "headModChannelId",
          "headModRoleId",
          "adminRoleIds",
          "supportRoleIds",
          "leadershipRoleIds",
          "reminderMinutesBefore",
          "checkinGraceMinutes",
          "checkoutGraceMinutes"
        ],
        redirectTo: "/hub/admin/discord",
        settings,
        submitLabel: "Kanaele & Rollen speichern"
      })}
    </section>
  `;

  return adminShell({
    body,
    botName,
    diagnostics,
    flashMessage,
    flashTone,
    settings,
    title: "Kanaele",
    user
  });
};

export const renderAdminAdvancedPage = ({
  botName,
  diagnostics,
  flashMessage = "",
  flashTone = "success",
  settings,
  teamRoutes,
  user
}) => {
  const body = `
    ${adminNav()}
    <div class="two-col">
      <section class="panel">
        <h2>Erweiterte Discord-Felder</h2>
        ${renderSettingsForm({
          fields: [
            "verifyPanelChannelId",
            "onboardingRoleId",
            "ticketCategoryId",
            "voiceCategoryId",
            "voicePanelChannelId",
            "joinLeaveLogChannelId",
            "verificationLogChannelId",
            "ticketLogChannelId",
            "voiceLogChannelId",
            "shiftLogChannelId",
            "incidentLogChannelId",
            "voiceRoomIdleMinutes",
            "hubIntroText",
            "teamSummaryIntro"
          ],
          redirectTo: "/hub/admin/advanced",
          settings,
          submitLabel: "Erweiterte Einstellungen speichern"
        })}
      </section>
      <section class="panel">
        <h2>Team-Routing</h2>
        <p class="muted">teamKey ist aktuell der Sonara-Rollenwert, zum Beispiel <code>moderator</code>.</p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>teamKey</th>
                <th>Rolle</th>
                <th>Kanal</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              ${teamRoutes.length ? teamRoutes.map(routeRow).join("") : "<tr><td colspan=\"4\">Noch keine Team-Routen angelegt.</td></tr>"}
            </tbody>
          </table>
        </div>
        <form method="post" action="/hub/admin/team-routes/save" style="margin-top: 18px;">
          <input type="hidden" name="redirectTo" value="/hub/admin/advanced" />
          <div class="inline-form">
            ${textInput({ label: "teamKey", name: "teamKey", placeholder: "moderator" })}
            ${textInput({ label: "Rollen-ID", name: "roleId", placeholder: "1234567890" })}
            ${textInput({ label: "Kanal-ID", name: "channelId", placeholder: "1234567890" })}
          </div>
          <button type="submit">Team-Route speichern</button>
        </form>
      </section>
    </div>
  `;

  return adminShell({
    body,
    botName,
    diagnostics,
    flashMessage,
    flashTone,
    settings,
    title: "Erweitert",
    user
  });
};
