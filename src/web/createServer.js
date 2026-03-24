import express from "express";

const getBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) {
    return "";
  }

  const [type, token] = authorizationHeader.split(" ");

  return type?.toLowerCase() === "bearer" ? token : "";
};

const parseMode = (value) => {
  return value === "replace" ? "replace" : "upsert";
};

export const createServer = ({ reminderService, shiftStore, timezone, webhookSecret }) => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_request, response) => {
    const shifts = await shiftStore.getUpcomingShifts();

    response.json({
      ok: true,
      timezone,
      upcomingShiftCount: shifts.length
    });
  });

  app.use("/api", (request, response, next) => {
    const bearerToken = getBearerToken(request.header("authorization"));
    const headerSecret = request.header("x-webhook-secret");

    if (bearerToken !== webhookSecret && headerSecret !== webhookSecret) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  });

  app.post("/api/shifts/sync", async (request, response) => {
    const shifts = Array.isArray(request.body?.shifts) ? request.body.shifts : [];
    const mode = parseMode(request.body?.mode);

    if (shifts.length === 0) {
      response.status(400).json({ error: "Request body must contain a non-empty shifts array." });
      return;
    }

    try {
      const savedShifts =
        mode === "replace"
          ? await shiftStore.replaceFutureShifts(shifts)
          : await shiftStore.upsertShifts(shifts);

      await reminderService.runCycle();

      response.json({
        mode,
        ok: true,
        savedShiftCount: savedShifts.length
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Unknown sync error."
      });
    }
  });

  app.get("/api/shifts", async (_request, response) => {
    const shifts = await shiftStore.getUpcomingShifts();
    response.json({ shifts });
  });

  return app;
};
