import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { SECRET_FORM_FIELDS, SETTINGS_FORM_FIELDS } from "../store/settings.js";
import {
  renderDashboardPage,
  renderErrorPage,
  renderLoginPage
} from "./panelTemplates.js";

const COOKIE_NAME = "operations_panel_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24;

const parseCookies = (cookieHeader) => {
  return Object.fromEntries(
    String(cookieHeader ?? "")
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const separatorIndex = chunk.indexOf("=");
        const key = separatorIndex >= 0 ? chunk.slice(0, separatorIndex) : chunk;
        const value = separatorIndex >= 0 ? chunk.slice(separatorIndex + 1) : "";
        return [key, decodeURIComponent(value)];
      })
  );
};

const signValue = (value, secret) => {
  return createHmac("sha256", secret).update(value).digest("hex");
};

const buildSignedCookieValue = (sessionId, secret) => {
  return `${sessionId}.${signValue(sessionId, secret)}`;
};

const verifySignedCookieValue = (signedValue, secret) => {
  if (!signedValue || !signedValue.includes(".")) {
    return "";
  }

  const [sessionId, signature] = signedValue.split(".", 2);
  return signValue(sessionId, secret) === signature ? sessionId : "";
};

const serializeCookie = ({ baseUrl, maxAgeSeconds, name, value }) => {
  const secure = String(baseUrl ?? "").startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
};

const clearCookie = ({ baseUrl, name }) => {
  const secure = String(baseUrl ?? "").startsWith("https://") ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
};

const buildDiscordAuthorizeUrl = ({ clientId, panelBaseUrl, state }) => {
  const search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${panelBaseUrl}/panel/auth/callback`,
    response_type: "code",
    scope: "identify",
    state
  });

  return `https://discord.com/api/oauth2/authorize?${search.toString()}`;
};

const exchangeDiscordCode = async ({ clientId, clientSecret, code, panelBaseUrl }) => {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${panelBaseUrl}/panel/auth/callback`
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Discord OAuth token exchange failed with status ${response.status}`);
  }

  return response.json();
};

const fetchDiscordIdentity = async (accessToken) => {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord identity request failed with status ${response.status}`);
  }

  return response.json();
};

export const createServer = ({ client, config, database, runtime }) => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  const getApiSecret = () => {
    return runtime.getSettings().websiteToBotSecret || config.websiteToBotSecret;
  };

  const authenticatePanelSession = async (request) => {
    const cookies = parseCookies(request.header("cookie"));
    const sessionId = verifySignedCookieValue(cookies[COOKIE_NAME], config.sessionSecret);
    if (!sessionId) {
      return null;
    }

    const session = database.getPanelSession(sessionId);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      if (sessionId) {
        database.deletePanelSession(sessionId);
      }
      return null;
    }

    const authorized = await runtime.isPanelUserAuthorized(session.userId);
    if (!authorized) {
      database.deletePanelSession(sessionId);
      return null;
    }

    return session;
  };

  const requirePanelAuth = async (request, response, next) => {
    const session = await authenticatePanelSession(request);
    if (!session) {
      response.redirect("/panel");
      return;
    }

    request.panelSession = session;
    next();
  };

  app.get("/", (_request, response) => {
    response.redirect("/panel");
  });

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      pendingOutboxCount: database.getPendingOutboxCount(),
      timezone: config.timezone,
      upcomingShiftCount: database.getUpcomingShifts().length
    });
  });

  app.use("/api", (request, response, next) => {
    const authorization = String(request.header("authorization") ?? "");
    const [type, token] = authorization.split(" ");
    const bearerToken = type?.toLowerCase() === "bearer" ? token : "";

    if (!getApiSecret() || bearerToken !== getApiSecret()) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  });

  app.post("/api/shifts/sync", async (request, response) => {
    const shifts = Array.isArray(request.body?.shifts) ? request.body.shifts : [];
    const mode = request.body?.mode === "replace" ? "replace" : "upsert";

    if (shifts.length === 0) {
      response.status(400).json({ error: "Request body must contain a non-empty shifts array." });
      return;
    }

    try {
      const result = await runtime.syncShifts({
        generatedAt: request.body?.generatedAt,
        mode,
        shifts
      });

      response.json({
        createdCount: result.changes.created.length,
        ok: true,
        removedCount: result.changes.removed.length,
        savedShiftCount: result.saved.length,
        updatedCount: result.changes.updated.length
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Unknown shift sync error."
      });
    }
  });

  app.get("/api/shifts", (_request, response) => {
    response.json({
      shifts: database.getUpcomingShifts()
    });
  });

  app.get("/panel", async (request, response) => {
    const session = await authenticatePanelSession(request);

    if (!session) {
      response.send(
        renderLoginPage({
          oauthReady: Boolean(config.clientSecret && config.panelBaseUrl),
          panelBaseUrl: config.panelBaseUrl
        })
      );
      return;
    }

    const diagnostics = await runtime.getDiagnostics();
    const settings = runtime.getSettings();
    const user = await client.users.fetch(session.userId).catch(() => ({
      discriminator: "0",
      id: session.userId,
      username: "Unbekannt"
    }));

    response.send(
      renderDashboardPage({
        diagnostics,
        queryState: String(request.query.state ?? ""),
        settings,
        teamRoutes: database.listTeamRoutes(),
        user
      })
    );
  });

  app.get("/panel/login", (request, response) => {
    if (!config.clientSecret || !config.panelBaseUrl) {
      response.status(500).send(
        renderErrorPage({
          message: "CLIENT_SECRET oder PANEL_BASE_URL fehlen. Das Panel kann sich so nicht ueber Discord anmelden.",
          title: "Panel-Konfiguration unvollstaendig"
        })
      );
      return;
    }

    const state = randomUUID();
    const redirectPath = typeof request.query.redirect === "string" ? request.query.redirect : "/panel";
    database.createOauthState({ redirectPath, state });
    response.redirect(
      buildDiscordAuthorizeUrl({
        clientId: config.clientId,
        panelBaseUrl: config.panelBaseUrl,
        state
      })
    );
  });

  app.get("/panel/auth/callback", async (request, response) => {
    const code = String(request.query.code ?? "");
    const state = String(request.query.state ?? "");

    try {
      const oauthState = database.consumeOauthState(state);
      if (!oauthState) {
        throw new Error("Ungueltiger oder abgelaufener OAuth-State.");
      }

      const tokenPayload = await exchangeDiscordCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        panelBaseUrl: config.panelBaseUrl
      });

      const identity = await fetchDiscordIdentity(tokenPayload.access_token);
      const authorized = await runtime.isPanelUserAuthorized(identity.id);

      if (!authorized) {
        response.status(403).send(
          renderErrorPage({
            message: "Dein Discord-Konto hat keine Berechtigung fuer dieses Panel.",
            title: "Zugriff verweigert"
          })
        );
        return;
      }

      const sessionId = randomUUID();
      database.createPanelSession({
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        sessionId,
        userId: identity.id
      });

      response.setHeader(
        "Set-Cookie",
        serializeCookie({
          baseUrl: config.panelBaseUrl,
          maxAgeSeconds: SESSION_DURATION_MS / 1000,
          name: COOKIE_NAME,
          value: buildSignedCookieValue(sessionId, config.sessionSecret)
        })
      );
      response.redirect(oauthState.redirectPath || "/panel");
    } catch (error) {
      response.status(500).send(
        renderErrorPage({
          message: error instanceof Error ? error.message : "Unbekannter OAuth-Fehler.",
          title: "Panel-Anmeldung fehlgeschlagen"
        })
      );
    }
  });

  app.get("/panel/logout", async (request, response) => {
    const session = await authenticatePanelSession(request);
    if (session) {
      database.deletePanelSession(session.sessionId);
    }

    response.setHeader(
      "Set-Cookie",
      clearCookie({
        baseUrl: config.panelBaseUrl,
        name: COOKIE_NAME
      })
    );
    response.redirect("/panel");
  });

  app.post("/panel/settings/general", requirePanelAuth, (request, response) => {
    const currentSettings = database.getAllSettings();
    const nextSettings = {};

    for (const field of SETTINGS_FORM_FIELDS) {
      if (field in request.body) {
        nextSettings[field] = String(request.body[field] ?? "").trim();
      }
    }

    for (const field of SECRET_FORM_FIELDS) {
      const nextValue = String(request.body[field] ?? "").trim();
      if (nextValue) {
        nextSettings[field] = nextValue;
      } else if (currentSettings[field]) {
        nextSettings[field] = currentSettings[field];
      }
    }

    database.setManySettings(nextSettings);
    response.redirect("/panel?state=saved");
  });

  app.post("/panel/team-routes/save", requirePanelAuth, (request, response) => {
    const teamKey = String(request.body.teamKey ?? "").trim();
    if (!teamKey) {
      response.redirect("/panel");
      return;
    }

    database.upsertTeamRoute({
      channelId: String(request.body.channelId ?? "").trim(),
      roleId: String(request.body.roleId ?? "").trim(),
      teamKey
    });

    response.redirect("/panel?state=saved");
  });

  app.post("/panel/team-routes/delete", requirePanelAuth, (request, response) => {
    const teamKey = String(request.body.teamKey ?? "").trim();
    if (teamKey) {
      database.deleteTeamRoute(teamKey);
    }

    response.redirect("/panel?state=saved");
  });

  app.post("/panel/actions/flush-outbox", requirePanelAuth, async (_request, response) => {
    await runtime.flushOutbox();
    response.redirect("/panel?state=flushed");
  });

  return app;
};
