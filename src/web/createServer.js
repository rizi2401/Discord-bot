import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { SETTINGS_FORM_FIELDS } from "../store/settings.js";
import {
  renderDiscordLinkPage,
  renderAdminPage,
  renderErrorPage,
  renderHubPage,
  renderLoginPage
} from "./panelTemplates.js";

const COOKIE_NAME = "sonara_ops_session";
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

const formatDateTime = (value) => {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
};

const mapHubFlash = ({ flash, tone }) => {
  if (!flash) {
    return { message: "", tone: "success" };
  }

  return {
    message: String(flash),
    tone: String(tone || "success")
  };
};

const normalizeLocalRedirect = (value, fallback = "/hub") => {
  const candidate = String(value ?? "").trim();
  if (!candidate.startsWith("/")) {
    return fallback;
  }

  if (candidate.startsWith("//")) {
    return fallback;
  }

  return candidate;
};

const asyncHandler = (handler) => {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
};

const buildShiftView = ({ activeSession, shift }) => {
  const now = Date.now();
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const canCheckIn = shift.requiresClocking && !activeSession && now >= start - 60 * 60 * 1000 && now <= end;
  const canCheckOut = shift.requiresClocking && activeSession?.shiftId === shift.id;

  let clockHint = "Diese Schicht ist nur informativ.";
  if (shift.requiresClocking) {
    if (canCheckOut) {
      clockHint = "Du bist fuer diese Schicht bereits eingestempelt.";
    } else if (activeSession) {
      clockHint = "Du bist aktuell bereits in einer anderen Schicht eingestempelt.";
    } else if (now < start - 60 * 60 * 1000) {
      clockHint = "Clock-in oeffnet 60 Minuten vor Schichtbeginn.";
    } else if (now > end) {
      clockHint = "Das Clocking-Fenster fuer diese Schicht ist bereits abgelaufen.";
    } else {
      clockHint = "Clocking ist fuer diese Schicht jetzt verfuegbar.";
    }
  }

  return {
    ...shift,
    canCheckIn,
    canCheckOut,
    clockHint,
    endsAtLabel: formatDateTime(shift.endsAt),
    startsAtLabel: formatDateTime(shift.startsAt)
  };
};

export const createServer = ({ client, config, database, runtime }) => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  const authenticateHubSession = async (request) => {
    const cookies = parseCookies(request.header("cookie"));
    const sessionId = verifySignedCookieValue(cookies[COOKIE_NAME], config.sessionSecret);
    if (!sessionId) {
      return null;
    }

    const session = await database.getWebSession(sessionId);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      if (sessionId) {
        await database.deleteWebSession(sessionId);
      }
      return null;
    }

    const user = await runtime.getHubUser(session.userId);
    if (!user) {
      await database.deleteWebSession(sessionId);
      return null;
    }

    await database.touchWebSession(sessionId, new Date());
    return { session, user };
  };

  const requireHubAuth = async (request, response, next) => {
    const auth = await authenticateHubSession(request);
    if (!auth) {
      response.redirect("/hub");
      return;
    }

    if (!auth.user.canAccessHub) {
      response.status(403).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zurueck zum Login",
          message: "Dein Sonara-Konto hat keinen Zugriff auf den Bot-Hub.",
          title: "Hub-Zugriff verweigert"
        })
      );
      return;
    }

    request.hubSession = auth.session;
    request.hubUser = auth.user;
    next();
  };

  const requireAdmin = async (request, response, next) => {
    const auth = await authenticateHubSession(request);
    if (!auth) {
      response.redirect("/hub");
      return;
    }

    if (!auth.user.isAdmin) {
      response.status(403).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Moderator-Hub",
          message: "Dein Sonara-Konto hat keinen Admin-Zugriff fuer den Bot-Hub.",
          title: "Admin-Zugriff verweigert"
        })
      );
      return;
    }

    request.hubSession = auth.session;
    request.hubUser = auth.user;
    next();
  };

  const requireImportSecret = (request, response, next) => {
    if (!config.importApiSecret) {
      response.status(404).json({ error: "Import API disabled." });
      return;
    }

    const authorization = String(request.header("authorization") ?? "");
    const [type, token] = authorization.split(" ");
    const bearerToken = type?.toLowerCase() === "bearer" ? token : "";

    if (bearerToken !== config.importApiSecret) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };

  app.get("/", (_request, response) => {
    response.redirect("/hub");
  });

  app.get("/panel", (_request, response) => {
    response.redirect("/hub");
  });

  app.get("/health", asyncHandler(async (_request, response) => {
    const diagnostics = await runtime.getDiagnostics();
    response.json({
      ok: true,
      timezone: config.timezone,
      trackedShiftCount: diagnostics.stats.upcomingShiftCount
    });
  }));

  app.get("/hub", asyncHandler(async (request, response) => {
    const auth = await authenticateHubSession(request);

    if (!auth) {
      response.send(
        renderLoginPage({
          botName: "Sonara Operations Bot"
        })
      );
      return;
    }

    if (!auth.user.canAccessHub) {
      response.status(403).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zurueck zum Login",
          message:
            "Dein Sonara-Konto ist zwar bekannt, hat aber keinen Zugriff auf den Hub. Discord-Verknuepfungen kannst du trotzdem ueber /verknuepfen starten.",
          title: "Hub-Zugriff verweigert"
        })
      );
      return;
    }

    const flashState = mapHubFlash({
      flash: request.query.flash,
      tone: request.query.tone
    });
    const hubData = await runtime.getModeratorHubData(auth.user.id);

    if (!hubData) {
      response.status(500).send(
        renderErrorPage({
          message: "Die Hub-Daten konnten gerade nicht geladen werden.",
          title: "Hub nicht verfuegbar"
        })
      );
      return;
    }

    response.send(
      renderHubPage({
        activeSession: hubData.activeSession,
        botName: "Sonara Operations Bot",
        flashMessage: flashState.message,
        flashTone: flashState.tone,
        shifts: hubData.shifts.map((shift) =>
          buildShiftView({
            activeSession: hubData.activeSession,
            shift
          })
        ),
        user: hubData.user
      })
    );
  }));

  app.get("/hub/admin", asyncHandler(requireAdmin), asyncHandler(async (request, response) => {
    const flashState = mapHubFlash({
      flash: request.query.flash,
      tone: request.query.tone
    });
    const adminData = await runtime.getAdminHubData();

    response.send(
      renderAdminPage({
        botName: "Sonara Operations Bot",
        diagnostics: adminData.diagnostics,
        flashMessage: flashState.message,
        flashTone: flashState.tone,
        settings: adminData.settings,
        teamRoutes: adminData.teamRoutes,
        user: request.hubUser,
        users: adminData.users
      })
    );
  }));

  app.get("/hub/discord-link", asyncHandler(async (request, response) => {
    const token = String(request.query.token ?? "").trim();
    if (!token) {
      response.status(400).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Login",
          message: "Der Verknuepfungs-Link ist unvollstaendig.",
          title: "Verknuepfung nicht moeglich"
        })
      );
      return;
    }

    const auth = await authenticateHubSession(request);
    const linkRequest = await runtime.getDiscordLinkRequest(token);
    if (!linkRequest) {
      response.status(404).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Login",
          message: "Dieser Verknuepfungs-Link wurde nicht gefunden oder ist bereits entfernt worden.",
          title: "Verknuepfungs-Link ungueltig"
        })
      );
      return;
    }

    if (linkRequest.consumedAt) {
      response.status(410).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Login",
          message: "Dieser Verknuepfungs-Link wurde bereits verwendet. Starte /verknuepfen im Discord-Server erneut.",
          title: "Verknuepfungs-Link bereits benutzt"
        })
      );
      return;
    }

    if (Date.parse(linkRequest.expiresAt) <= Date.now()) {
      response.status(410).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Login",
          message: "Dieser Verknuepfungs-Link ist abgelaufen. Starte /verknuepfen im Discord-Server erneut.",
          title: "Verknuepfungs-Link abgelaufen"
        })
      );
      return;
    }

    if (!auth) {
      response.send(
        renderLoginPage({
          botName: "Sonara Operations Bot",
          introMessage:
            "Melde dich mit deinem Sonara-Konto an, um das Discord-Konto aus dem Link sicher zu verknuepfen.",
          redirectTo: `/hub/discord-link?token=${encodeURIComponent(token)}`
        })
      );
      return;
    }

    const conflictUser = await database.findUserByDiscordUserId(linkRequest.discordUserId);
    const hasConflict = conflictUser && conflictUser.id !== auth.user.id;

    response.send(
      renderDiscordLinkPage({
        botName: "Sonara Operations Bot",
        conflictUser: hasConflict ? conflictUser : null,
        linkRequest,
        token,
        user: auth.user
      })
    );
  }));

  app.post("/auth/login", asyncHandler(async (request, response) => {
    const login = String(request.body.login ?? "").trim();
    const password = String(request.body.password ?? "");
    const redirectTo = normalizeLocalRedirect(request.body.redirectTo, "/hub");

    if (!login || !password) {
      response.status(400).send(
        renderLoginPage({
          botName: "Sonara Operations Bot",
          errorMessage: "Bitte gib Benutzername, VRChat-Name oder Discord-Name plus Passwort ein.",
          redirectTo
        })
      );
      return;
    }

    const user = await runtime.authenticateHubUser(login, password);
    if (!user) {
      response.status(401).send(
        renderLoginPage({
          botName: "Sonara Operations Bot",
          errorMessage: "Die Sonara-Zugangsdaten sind ungueltig.",
          redirectTo
        })
      );
      return;
    }

    const loginIsForLinkFlow = redirectTo.startsWith("/hub/discord-link");

    if (!user.canAccessHub && !loginIsForLinkFlow) {
      response.status(403).send(
        renderLoginPage({
          botName: "Sonara Operations Bot",
          errorMessage: "Dein Sonara-Konto hat keinen Zugriff auf den Bot-Hub.",
          redirectTo
        })
      );
      return;
    }

    const sessionId = randomUUID();
    await database.createWebSession({
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      sessionId,
      userId: user.id
    });

    response.setHeader(
      "Set-Cookie",
      serializeCookie({
        baseUrl: config.botBaseUrl,
        maxAgeSeconds: SESSION_DURATION_MS / 1000,
        name: COOKIE_NAME,
        value: buildSignedCookieValue(sessionId, config.sessionSecret)
      })
    );

    response.redirect(loginIsForLinkFlow ? redirectTo : user.isAdmin ? "/hub/admin" : "/hub");
  }));

  app.post("/hub/discord-link/confirm", asyncHandler(async (request, response) => {
    const auth = await authenticateHubSession(request);
    if (!auth) {
      response.redirect("/hub");
      return;
    }

    const token = String(request.body.token ?? "").trim();
    if (!token) {
      response.status(400).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Login",
          message: "Fuer die Discord-Verknuepfung fehlt der Token.",
          title: "Verknuepfung nicht moeglich"
        })
      );
      return;
    }

    const result = await runtime.confirmDiscordLink({
      token,
      userId: auth.user.id
    });

    if (!result.ok) {
      if (result.reason === "discord_conflict" && result.conflictUser) {
        response.status(409).send(
          renderDiscordLinkPage({
            botName: "Sonara Operations Bot",
            conflictUser: result.conflictUser,
            linkRequest: await runtime.getDiscordLinkRequest(token),
            token,
            user: auth.user
          })
        );
        return;
      }

      response.status(400).send(
        renderErrorPage({
          actionHref: "/hub",
          actionLabel: "Zum Login",
          message:
            result.reason === "request_expired"
              ? "Der Verknuepfungs-Link ist abgelaufen. Starte /verknuepfen erneut."
              : result.reason === "request_consumed"
                ? "Der Verknuepfungs-Link wurde bereits benutzt. Starte /verknuepfen erneut."
                : "Die Discord-Verknuepfung konnte nicht abgeschlossen werden.",
          title: "Verknuepfung fehlgeschlagen"
        })
      );
      return;
    }

    if (result.user?.canAccessHub) {
      response.redirect("/hub?flash=Discord-Konto erfolgreich verknuepft.&tone=success");
      return;
    }

    response.send(
      renderErrorPage({
        actionHref: "/hub",
        actionLabel: "Zurueck zum Login",
        message:
          "Dein Discord-Konto wurde erfolgreich verknuepft. Fuer dieses Sonara-Konto gibt es aber keinen Hub-Zugriff.",
        title: "Verknuepfung erfolgreich"
      })
    );
  }));

  app.post("/auth/logout", asyncHandler(async (request, response) => {
    const auth = await authenticateHubSession(request);
    if (auth) {
      await database.deleteWebSession(auth.session.sessionId);
    }
    response.setHeader(
      "Set-Cookie",
      clearCookie({
        baseUrl: config.botBaseUrl,
        name: COOKIE_NAME
      })
    );
    response.redirect("/hub");
  }));

  app.post("/hub/clock-in", asyncHandler(requireHubAuth), asyncHandler(async (request, response) => {
    const result = await runtime.handleHubCheckIn({
      shiftId: String(request.body.shiftId ?? "").trim(),
      userId: request.hubUser.id
    });

    response.redirect(
      `/hub?flash=${encodeURIComponent(result.message)}&tone=${encodeURIComponent(
        result.ok ? "success" : "error"
      )}`
    );
  }));

  app.post("/hub/clock-out", asyncHandler(requireHubAuth), asyncHandler(async (request, response) => {
    const result = await runtime.handleHubCheckOut({
      shiftId: String(request.body.shiftId ?? "").trim(),
      userId: request.hubUser.id
    });

    response.redirect(
      `/hub?flash=${encodeURIComponent(result.message)}&tone=${encodeURIComponent(
        result.ok ? "success" : "error"
      )}`
    );
  }));

  app.post("/hub/admin/settings/general", asyncHandler(requireAdmin), asyncHandler(async (request, response) => {
    const nextSettings = {};

    for (const field of SETTINGS_FORM_FIELDS) {
      if (field in request.body) {
        nextSettings[field] = String(request.body[field] ?? "").trim();
      }
    }

    await database.setManySettings(nextSettings);
    await runtime.refreshSettings();
    response.redirect("/hub/admin?flash=Konfiguration gespeichert.&tone=success");
  }));

  app.post("/hub/admin/users/:userId/dm-preferences", asyncHandler(requireAdmin), asyncHandler(async (request, response) => {
    const targetUserId = String(request.params.userId ?? "").trim();
    if (!targetUserId) {
      response.redirect("/hub/admin?flash=Sonara-User-ID fehlt.&tone=error");
      return;
    }

    const enabled = String(request.body.shiftDmEnabled ?? "").trim() === "true";
    await runtime.setShiftDmPreference({
      enabled,
      targetUserId,
      updatedBy: request.hubUser.id
    });

    response.redirect(
      `/hub/admin?flash=${encodeURIComponent(
        enabled ? "Schicht-DMs aktiviert." : "Schicht-DMs deaktiviert."
      )}&tone=success`
    );
  }));

  app.post("/hub/admin/users/:userId/unlink-discord", asyncHandler(requireAdmin), asyncHandler(async (request, response) => {
    const targetUserId = String(request.params.userId ?? "").trim();
    if (!targetUserId) {
      response.redirect("/hub/admin?flash=Sonara-User-ID fehlt.&tone=error");
      return;
    }

    await runtime.unlinkDiscordIdentity({
      targetUserId,
      updatedBy: request.hubUser.id
    });

    response.redirect("/hub/admin?flash=Discord-Verknuepfung entfernt.&tone=success");
  }));

  app.post("/hub/admin/team-routes/save", asyncHandler(requireAdmin), asyncHandler(async (request, response) => {
    const teamKey = String(request.body.teamKey ?? "").trim();
    if (!teamKey) {
      response.redirect("/hub/admin?flash=teamKey fehlt.&tone=error");
      return;
    }

    await database.upsertTeamRoute({
      channelId: String(request.body.channelId ?? "").trim(),
      roleId: String(request.body.roleId ?? "").trim(),
      teamKey
    });

    response.redirect("/hub/admin?flash=Team-Route gespeichert.&tone=success");
  }));

  app.post("/hub/admin/team-routes/delete", asyncHandler(requireAdmin), asyncHandler(async (request, response) => {
    const teamKey = String(request.body.teamKey ?? "").trim();
    if (teamKey) {
      await database.deleteTeamRoute(teamKey);
    }

    response.redirect("/hub/admin?flash=Team-Route entfernt.&tone=success");
  }));

  app.post("/hub/admin/actions/refresh-shifts", asyncHandler(requireAdmin), asyncHandler(async (_request, response) => {
    await runtime.refreshTrackedShifts();
    response.redirect("/hub/admin?flash=Sonara-Schichten neu eingelesen.&tone=success");
  }));

  app.post("/api/shifts/sync", asyncHandler(requireImportSecret), asyncHandler(async (request, response) => {
    const shifts = Array.isArray(request.body?.shifts) ? request.body.shifts : [];
    const mode = request.body?.mode === "replace" ? "replace" : "upsert";

    if (shifts.length === 0) {
      response.status(400).json({ error: "Request body must contain a non-empty shifts array." });
      return;
    }

    try {
      const result = await runtime.importTrackedShifts({
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
        error: error instanceof Error ? error.message : "Unknown shift import error."
      });
    }
  }));

  app.get("/api/shifts", asyncHandler(requireImportSecret), asyncHandler(async (_request, response) => {
    response.json({
      shifts: await database.getUpcomingShifts()
    });
  }));

  app.use((error, request, response, _next) => {
    console.error("Web request failed:", error);

    if (request.path.startsWith("/api/")) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unknown API error."
      });
      return;
    }

    response.status(500).send(
      renderErrorPage({
        message:
          error instanceof Error
            ? error.message
            : "Unbekannter Fehler im Sonara Operations Hub.",
        title: "Hub-Fehler"
      })
    );
  });

  return app;
};
