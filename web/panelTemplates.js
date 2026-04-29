const escapeHtml = (value) => {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const card = (label, value) => {
  return `
    <div class="card">
      <div class="card-label">${escapeHtml(label)}</div>
      <div class="card-value">${escapeHtml(value)}</div>
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

const secretInput = ({ label, name, hasValue }) => {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="password" name="${escapeHtml(name)}" value="" placeholder="${hasValue ? "gesetzt - leer lassen zum Beibehalten" : "neuen Secret-Wert eintragen"}" />
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
        <form method="post" action="/panel/team-routes/delete">
          <input type="hidden" name="teamKey" value="${escapeHtml(route.teamKey)}" />
          <button type="submit" class="danger">Entfernen</button>
        </form>
      </td>
    </tr>
  `;
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
        --bg: #10131b;
        --panel: #171c28;
        --panel-2: #1f2636;
        --text: #f2f5ff;
        --muted: #9aa7c7;
        --accent: #66d9c1;
        --danger: #ff7a7a;
        --border: #2f3850;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #0d1118 0%, #141926 100%);
        color: var(--text);
      }
      a { color: var(--accent); text-decoration: none; }
      .container { max-width: 1180px; margin: 0 auto; padding: 32px 20px 64px; }
      .hero, .panel, .notice {
        background: rgba(23, 28, 40, 0.95);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.25);
      }
      .hero h1 { margin-top: 0; margin-bottom: 8px; }
      .hero p, .notice p { color: var(--muted); }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .card {
        background: var(--panel-2);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
      }
      .card-label {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 6px;
      }
      .card-value {
        font-size: 24px;
        font-weight: 700;
      }
      .two-col {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 20px;
      }
      @media (max-width: 920px) {
        .two-col { grid-template-columns: 1fr; }
      }
      .field {
        display: block;
        margin-bottom: 14px;
      }
      .field span {
        display: block;
        margin-bottom: 6px;
        font-size: 14px;
        color: var(--muted);
      }
      input, textarea, button {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: #0f1420;
        color: var(--text);
        padding: 12px 14px;
        font: inherit;
      }
      textarea { min-height: 110px; resize: vertical; }
      button {
        cursor: pointer;
        background: var(--accent);
        color: #07130f;
        font-weight: 700;
      }
      button.secondary {
        background: #2c3750;
        color: var(--text);
      }
      button.danger {
        background: var(--danger);
        color: #240606;
      }
      .inline-form {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .inline-form > * {
        flex: 1 1 220px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      th, td {
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid var(--border);
      }
      .muted { color: var(--muted); }
      .pill {
        display: inline-block;
        background: #233145;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 8px 12px;
        margin-right: 8px;
        margin-bottom: 8px;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
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

export const renderLoginPage = ({ oauthReady, panelBaseUrl }) => {
  const body = `
    <section class="hero">
      <h1>Operations-Bot Adminpanel</h1>
      <p>Dieses Panel verwaltet Welcome, Tickets, Voice-Raeume, Schicht-Automation und Website-Kopplung des Bots.</p>
    </section>
    <section class="notice">
      ${
        oauthReady
          ? `
            <p>Du meldest dich ueber Discord an. Zugriff bekommen nur Personen mit Admin- oder Head-Team-Rechten.</p>
            <div class="actions">
              <a href="/panel/login"><button>Anmelden mit Discord</button></a>
            </div>
          `
          : `
            <p>Panel-Login ist noch nicht bereit. Bitte setze in der Umgebung mindestens <code>CLIENT_SECRET</code> und <code>PANEL_BASE_URL</code>.</p>
            <p class="muted">Aktueller Panel-Base-URL-Wert: ${escapeHtml(panelBaseUrl || "nicht gesetzt")}</p>
          `
      }
    </section>
  `;

  return shell({ body, title: "Operations-Bot Login" });
};

export const renderErrorPage = ({ message, title }) => {
  const body = `
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <a href="/panel"><button class="secondary">Zurueck zum Panel</button></a>
      </div>
    </section>
  `;

  return shell({ body, title });
};

export const renderDashboardPage = ({
  diagnostics,
  queryState,
  settings,
  teamRoutes,
  user
}) => {
  const successMessage =
    queryState === "saved"
      ? "<div class=\"pill\">Einstellungen gespeichert</div>"
      : queryState === "flushed"
        ? "<div class=\"pill\">Outbox erneut angestossen</div>"
        : "";

  const warningMessage = diagnostics.missingSettings.length
    ? `
      <div class="notice">
        <strong>Offene Konfigurationsluecken:</strong>
        <p>${escapeHtml(diagnostics.missingSettings.join(", "))}</p>
      </div>
    `
    : "";

  const body = `
    <section class="hero">
      <div class="actions" style="justify-content: space-between; align-items: center;">
        <div>
          <h1>Operations-Bot Dashboard</h1>
          <p>Angemeldet als ${escapeHtml(user.username)}#${escapeHtml(user.discriminator || "0")} (${escapeHtml(user.id)})</p>
        </div>
        <div class="actions">
          <a href="/panel/logout"><button class="secondary">Abmelden</button></a>
        </div>
      </div>
      ${successMessage}
    </section>
    ${warningMessage}
    <section class="panel">
      <h2>Status</h2>
      <div class="grid">
        ${card("Kommende Schichten", diagnostics.stats.upcomingShiftCount)}
        ${card("Offene Tickets", diagnostics.stats.openTicketCount)}
        ${card("Aktive Clock-Sessions", diagnostics.stats.activeClockCount)}
        ${card("Offene Vorfaelle", diagnostics.stats.openIncidentCount)}
        ${card("Voice-Raeume", diagnostics.stats.activeVoiceRoomCount)}
        ${card("Ausstehende Website-Callbacks", diagnostics.pendingOutboxCount)}
      </div>
      <form method="post" action="/panel/actions/flush-outbox" style="margin-top: 16px;">
        <button type="submit" class="secondary">Website-Callbacks jetzt erneut versuchen</button>
      </form>
    </section>
    <div class="two-col">
      <section class="panel">
        <h2>Server-Konfiguration</h2>
        <form method="post" action="/panel/settings/general">
          ${textInput({ label: "Welcome-Kanal-ID", name: "welcomeChannelId", value: settings.raw.welcomeChannelId })}
          ${textInput({ label: "Regel-Kanal-ID", name: "rulesChannelId", value: settings.raw.rulesChannelId })}
          ${textInput({ label: "Verify-Panel-Kanal-ID", name: "verifyPanelChannelId", value: settings.raw.verifyPanelChannelId })}
          ${textInput({ label: "Mitgliederrolle-ID", name: "memberRoleId", value: settings.raw.memberRoleId })}
          ${textInput({ label: "Onboarding-Rolle-ID", name: "onboardingRoleId", value: settings.raw.onboardingRoleId })}
          ${textInput({ label: "Ticket-Kategorie-ID", name: "ticketCategoryId", value: settings.raw.ticketCategoryId })}
          ${textInput({ label: "Support-Rollen (Komma-getrennt)", name: "supportRoleIds", value: settings.raw.supportRoleIds })}
          ${textInput({ label: "Leitungsrollen (Komma-getrennt)", name: "leadershipRoleIds", value: settings.raw.leadershipRoleIds })}
          ${textInput({ label: "Voice-Kategorie-ID", name: "voiceCategoryId", value: settings.raw.voiceCategoryId })}
          ${textInput({ label: "Voice-Panel-Kanal-ID", name: "voicePanelChannelId", value: settings.raw.voicePanelChannelId })}
          ${textInput({ label: "Reminder-/Fallback-Kanal-ID", name: "reminderChannelId", value: settings.raw.reminderChannelId })}
          ${textInput({ label: "Head-Mod-Kanal-ID", name: "headModChannelId", value: settings.raw.headModChannelId })}
          ${textInput({ label: "Head-Mod-Rolle-ID", name: "headModRoleId", value: settings.raw.headModRoleId })}
          ${textInput({ label: "Panel-Admin-Rollen (Komma-getrennt)", name: "adminRoleIds", value: settings.raw.adminRoleIds })}
          ${textInput({ label: "Join/Leave-Log-Kanal-ID", name: "joinLeaveLogChannelId", value: settings.raw.joinLeaveLogChannelId })}
          ${textInput({ label: "Verify-Log-Kanal-ID", name: "verificationLogChannelId", value: settings.raw.verificationLogChannelId })}
          ${textInput({ label: "Ticket-Log-Kanal-ID", name: "ticketLogChannelId", value: settings.raw.ticketLogChannelId })}
          ${textInput({ label: "Voice-Log-Kanal-ID", name: "voiceLogChannelId", value: settings.raw.voiceLogChannelId })}
          ${textInput({ label: "Schicht-/Clock-Log-Kanal-ID", name: "shiftLogChannelId", value: settings.raw.shiftLogChannelId })}
          ${textInput({ label: "Incident-Log-Kanal-ID", name: "incidentLogChannelId", value: settings.raw.incidentLogChannelId })}
          ${textInput({ label: "Reminder-Minuten vorher", name: "reminderMinutesBefore", value: settings.raw.reminderMinutesBefore })}
          ${textInput({ label: "Check-in-Gnadenfrist (Minuten)", name: "checkinGraceMinutes", value: settings.raw.checkinGraceMinutes })}
          ${textInput({ label: "Check-out-Gnadenfrist (Minuten)", name: "checkoutGraceMinutes", value: settings.raw.checkoutGraceMinutes })}
          ${textInput({ label: "Voice-Raum-Leerlauf (Minuten)", name: "voiceRoomIdleMinutes", value: settings.raw.voiceRoomIdleMinutes })}
          ${textInput({ label: "Website-Basis-URL", name: "websiteBaseUrl", value: settings.raw.websiteBaseUrl, placeholder: "https://deine-website.tld" })}
          ${textInput({ label: "Website-Clock-Event-Pfad", name: "websiteClockEventPath", value: settings.raw.websiteClockEventPath })}
          ${secretInput({ label: "Website -> Bot Secret", name: "websiteToBotSecret", hasValue: Boolean(settings.websiteToBotSecret) })}
          ${secretInput({ label: "Bot -> Website Secret", name: "botToWebsiteSecret", hasValue: Boolean(settings.botToWebsiteSecret) })}
          <label class="field">
            <span>Team-Benachrichtigungs-Text</span>
            <textarea name="teamSummaryIntro">${escapeHtml(settings.raw.teamSummaryIntro)}</textarea>
          </label>
          <button type="submit">Konfiguration speichern</button>
        </form>
      </section>
      <section class="panel">
        <h2>Team-Routing</h2>
        <p class="muted">Jeder <code>teamKey</code> aus dem Website-Sync kann auf eine Rolle und einen Teamkanal gemappt werden.</p>
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
        <form method="post" action="/panel/team-routes/save" style="margin-top: 18px;">
          <div class="inline-form">
            ${textInput({ label: "teamKey", name: "teamKey", placeholder: "moderation" })}
            ${textInput({ label: "Rollen-ID", name: "roleId", placeholder: "1234567890" })}
            ${textInput({ label: "Kanal-ID", name: "channelId", placeholder: "1234567890" })}
          </div>
          <button type="submit">Team-Route speichern</button>
        </form>
        <h2 style="margin-top: 28px;">Hinweise</h2>
        <p class="muted">Die Panels fuer Verify, Tickets und Voice-Raeume postest du direkt in Discord ueber den Slash-Command <code>/panel-posten</code>.</p>
        <div>
          <span class="pill">Deutschsprachige V1</span>
          <span class="pill">Single-Guild</span>
          <span class="pill">SQLite aktiv</span>
        </div>
      </section>
    </div>
  `;

  return shell({ body, title: "Operations-Bot Dashboard" });
};
