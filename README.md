# Moderation Shift Bot

Dieser Discord-Bot kann an deine Moderations-Planungswebseite gekoppelt werden und erinnert Moderatoren automatisch an ihre kommenden Schichten.

## Funktionen

- Discord-DM-Erinnerungen vor Schichtbeginn
- Fallback in einen Discord-Textkanal, falls DMs blockiert sind
- Gesicherte Webhook-Schnittstelle fuer deine Planungswebseite
- Slash-Commands fuer kommende persoenliche Schichten
- Lokale JSON-Speicherung der synchronisierten Schichten

## Installation

1. `npm.cmd install`
2. `.env.example` nach `.env` kopieren
3. Werte in `.env` eintragen
4. `npm.cmd start`

## Benoetigte Umgebungsvariablen

- `DISCORD_TOKEN`: Bot-Token aus dem Discord Developer Portal
- `CLIENT_ID`: Application ID deines Bots
- `GUILD_ID`: Discord-Server fuer die Slash-Commands
- `WEBHOOK_SECRET`: gemeinsames Geheimnis zwischen Webseite und Bot
- `PORT`: HTTP-Port des Webhook-Servers
- `TIMEZONE`: Standard-Zeitzone, z. B. `Europe/Berlin`
- `REMINDER_MINUTES_BEFORE`: Kommaseparierte Liste, z. B. `1440,60,15`
- `REMINDER_CHANNEL_ID`: Optionaler Kanal fuer Fallback-Erinnerungen

## Format fuer die Webseite

Deine Webseite kann zukuenftige Schichten per `POST /api/shifts/sync` senden.

Header:

- `Authorization: Bearer <WEBHOOK_SECRET>`

Body:

```json
{
  "mode": "replace",
  "shifts": [
    {
      "id": "shift-2026-03-24-evening",
      "moderatorName": "Lena",
      "discordUserId": "123456789012345678",
      "startsAt": "2026-03-24T18:00:00+01:00",
      "endsAt": "2026-03-24T22:00:00+01:00",
      "notes": "Abendmoderation"
    }
  ]
}
```

`mode: "replace"` ersetzt alle zukuenftigen Schichten durch die gesendete Liste. Ohne `mode` werden Schichten per `id` aktualisiert oder ergaenzt.

## Beispiel fuer eine Webseiten-Anbindung

```js
await fetch("http://localhost:3000/api/shifts/sync", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.WEBHOOK_SECRET}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    mode: "replace",
    shifts: futureShifts.map((shift) => ({
      id: shift.id,
      moderatorName: shift.moderatorName,
      discordUserId: shift.discordUserId,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      notes: shift.notes
    }))
  })
});
```

## Discord-Kommandos

- `/meine-schichten`: Zeigt die naechsten eigenen Schichten
- `/schicht-stats`: Zeigt die Anzahl aller kommenden Schichten

## Wichtiger Hinweis zur Kopplung

Deine Planungswebseite muss pro Moderator die Discord-User-ID kennen oder speichern. Ohne `discordUserId` kann der Bot keine zielgerichteten Erinnerungen senden.
