# Sonara Operations Bot

Dieser Bot ist jetzt als eigenstaendiger Operations-Service fuer genau einen Discord-Server aufgebaut. Er laeuft als **separates Repo und separater Render-Service** neben `Sonara`, nutzt aber **dieselbe Postgres-Datenbank**. `Sonara` bleibt die Hauptquelle fuer Nutzer, Rollen, Discord-Verknuepfungen und Schichten. Der Bot speichert nur seine eigenen Betriebsdaten in einem eigenen Schema, standardmaessig `bot_ops`.

## Was die aktuelle Version kann

- deutschsprachiger Moderator-Hub mit Sonara-Login
- eigener Admin-Hub fuer Bot-Konfiguration
- Welcome-Nachrichten und Verify per Button
- Ticketsystem mit privaten Kanaelen, Claim und Schliessen
- private temporaere Voice-Raeume fuer Mitglieder
- Schicht-Erinnerungen per DM
- Ein- und Ausstempeln per DM-Button, Slash-Command und Web-Hub
- No-Show- und fehlendes Ausstempeln mit Eskalation
- Team-Benachrichtigungen anhand von `teamKey`
- Schichtdaten direkt aus Sonara-Tabellen statt lokaler SQLite-Datei

## Architektur

- `Sonara`: fuehrendes Websystem fuer Accounts, Rollen, Discord-IDs und Schichten
- `discord bot`: eigener Service fuer Discord-Automation und separaten Hub
- `Postgres`: gemeinsame Datenbank
- `bot_ops` Schema:
  - Einstellungen
  - Team-Routing
  - getrackte Schicht-Snapshots
  - Reminder-Historie
  - Clock-Sessions
  - Incidents
  - Tickets
  - Voice-Raeume
  - Web-Sessions

## Login und Rechte

Der Hub nutzt **dieselben Zugangsdaten wie Sonara**. Es gibt keinen Discord-OAuth-Login mehr fuer das Webpanel.

- **Admins** in Sonara duerfen den Admin-Hub oeffnen.
- **Moderatoren** in Sonara duerfen den Moderator-Hub nutzen.
- Das Rollen-Mapping kommt aus den Sonara-Rollen-Tabellen.

## Wichtige Routen

- `GET /health`
  - einfacher Health-Check
- `GET /hub`
  - Login und Moderator-Hub
- `GET /hub/admin`
  - Admin-Hub fuer Bot-Konfiguration
- `POST /hub/clock-in`
  - Web-Fallback fuer Check-in
- `POST /hub/clock-out`
  - Web-Fallback fuer Check-out

Optional fuer Alt-Migrationen:

- `POST /api/shifts/sync`
- `GET /api/shifts`

Diese beiden API-Routen sind nur aktiv, wenn `IMPORT_API_SECRET` gesetzt ist. Sie sind nur als Legacy-Import-/Backfill-Werkzeug gedacht, nicht mehr als Hauptintegration.

## Installation lokal

1. `npm.cmd install`
2. `.env.example` nach `.env` kopieren
3. Werte fuer Discord, Postgres und Sonara-Schema eintragen
4. `npm.cmd start`

## Pflicht-Umgebungsvariablen

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `DATABASE_URL`
- `SESSION_SECRET`

## Wichtige optionale Umgebungsvariablen

- `BOT_BASE_URL`
- `BOT_SCHEMA`
- `IMPORT_API_SECRET`
- `TIMEZONE`
- `REMINDER_MINUTES_BEFORE`
- `CHECKIN_GRACE_MINUTES`
- `CHECKOUT_GRACE_MINUTES`
- `VOICE_ROOM_IDLE_MINUTES`
- `SHIFT_LOOKBACK_HOURS`
- `SHIFT_LOOKAHEAD_DAYS`

## Sonara-Schema-Annahmen

Standardmaessig erwartet der Bot diese Sonara-Struktur:

- `users`
- `user_roles`
- `roles`
- `shifts`

Standardspalten:

- Nutzer:
  - `id`
  - `username`
  - `display_name`
  - `password_hash`
  - `is_active`
  - `discord_user_id`
- Rollen:
  - `id`
  - `slug`
  - `name`
- Schichten:
  - `id`
  - `user_id`
  - `starts_at`
  - `ends_at`
  - `notes`
  - `team_key`
  - `updated_at`
  - `requires_clocking`
  - `status`

Wenn Sonara andere Tabellennamen oder Spalten verwendet, kannst du sie ueber `.env` anpassen.

## Wichtige Voraussetzung fuer DM-Erinnerungen

Die Discord-Verknuepfung muss in Sonara gepflegt sein:

- Sonara-Nutzerkonto
- dazu gespeicherte `discord_user_id`

Ohne diese Zuordnung funktioniert der Web-Hub zwar weiter, aber DMs und automatische Discord-Zustellung koennen nur als Fallback in einen Reminder-Kanal landen.

## Slash-Commands

- `/meine-schichten`
- `/einstempeln`
- `/ausstempeln`
- `/ticket`
- `/raum-einladen`
- `/raum-schliessen`
- `/bot-status`
- `/test-benachrichtigung`
- `/panel-posten`

## Deployment auf Render

- `Sonara` und der Bot bleiben getrennte Services.
- Beide zeigen auf dieselbe `DATABASE_URL`.
- Der Bot braucht keine SQLite-Disk mehr.
- `BOT_BASE_URL` sollte auf die oeffentliche Bot-URL zeigen, damit Session-Cookies sauber auf `Secure` geschaltet werden.

## Checks

- `npm.cmd run check`

## Aktuelle bewusst getroffene Annahmen

- ein Discord-Server
- deutschsprachige Texte
- Sonara-Rollen entscheiden ueber Hub-Zugriff
- Discord-Rollen-IDs fuer Tickets, Head-Mod, Voice und Logs werden im Admin-Hub gepflegt
- Passwortpruefung laeuft standardmaessig ueber `bcrypt_or_plain`
  - fuer produktive Sonara-Setups sollte das Passwortformat mit der echten Website abgeglichen werden
