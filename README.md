# Sonara Operations Bot

Dieser Bot laeuft als eigener Discord- und Hub-Service neben `Sonara`, nutzt aber dieselbe Postgres-Datenbank. `Sonara` bleibt die fachliche Quelle fuer Nutzer, Rollen, Discord-Verknuepfungen, Schichten und die kanonischen Ein-/Ausstempelungen. Der Bot speichert nur seinen eigenen Betriebszustand im Schema `bot_ops`.

## Was die aktuelle Version kann

- Sonara-Login im separaten Moderator- und Admin-Hub
- Discord-Selbstverknuepfung ueber `/verknuepfen`
- frei steuerbare Schicht-DMs pro Sonara-Konto
- Welcome-Nachrichten und Verify per Button
- Ticketsystem mit privaten Kanaelen, Claim und Schliessen
- private temporaere Voice-Raeume fuer Mitglieder
- Schicht-Erinnerungen per Discord-DM
- Ein- und Ausstempeln per DM-Button, Slash-Command und Web-Hub
- No-Show- und Checkout-Eskalationen
- Team-Benachrichtigungen auf Basis von `users.role`

## Rollenlogik

- `admin`
  - Admin-Hub
- `moderator`
  - Moderator-Hub
- `moderation_lead`
  - Moderator-Hub
- `planner`
  - kein Bot-Hub
- `member`
  - kein Bot-Hub

Wichtig:

- Hub-Zugriff bleibt rollenbasiert.
- Schicht-DMs sind **nicht mehr hart an die Rolle gebunden**.
- Ob jemand DMs bekommt, wird im Admin-Hub pro Person gesteuert.

## Sonara-Quellen

Der Bot liest direkt aus diesen Sonara-Tabellen:

- `public.users`
- `public.shifts`
- `public.time_entries`

Erwartete Kernspalten:

- `users.id`
- `users.username`
- `users.display_name`
- `users.role`
- `users.vrchat_name`
- `users.discord_name`
- `users.discord_user_id`
- `users.password_hash`
- `users.is_blocked`
- `shifts.id`
- `shifts.member_id`
- `shifts.date_key`
- `shifts.start_time`
- `shifts.end_time`
- `shifts.shift_type`
- `shifts.world`
- `shifts.task`
- `shifts.notes`
- `shifts.is_lead`
- `shifts.updated_at`
- `time_entries.id`
- `time_entries.user_id`
- `time_entries.shift_id`
- `time_entries.check_in_at`
- `time_entries.check_out_at`
- `time_entries.shift_snapshot`

## Login

Der Hub nutzt dieselben Zugangsdaten wie Sonara.

- akzeptiert `username`, `vrchat_name` oder `discord_name`
- prueft Passwoerter gegen Sonaras `password_hash`
- erwartet Sonaras `scrypt`-Format `salt:hash`

Es gibt keinen Discord-OAuth-Login fuer den Hub.

## Clocking

- Sonaras `public.time_entries` ist die fachlich bindende Clocking-Tabelle
- der Bot schreibt parallel eine eigene Spiegelung fuer Reminder-, Audit- und Incident-Zustand
- No-Show und fehlender Checkout werden aus Sonara-Schichten plus `time_entries` erkannt

## Wichtige Routen

- `GET /health`
- `GET /hub`
- `GET /hub/admin`
- `GET /hub/discord-link?token=...`
- `POST /hub/discord-link/confirm`
- `POST /hub/clock-in`
- `POST /hub/clock-out`
- `POST /hub/admin/users/:id/dm-preferences`
- `POST /hub/admin/users/:id/unlink-discord`

Optional fuer Legacy-Importe:

- `POST /api/shifts/sync`
- `GET /api/shifts`

Diese Import-Routen sind nur fuer Backfill oder Notimporte gedacht und nur aktiv, wenn `IMPORT_API_SECRET` gesetzt ist.

## Installation lokal

1. `npm.cmd install`
2. `.env.example` nach `.env` kopieren
3. Discord- und Postgres-Werte eintragen
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

## Sonara-Schema-Anpassung per .env

Falls dein Sonara-Schema spaeter andere Tabellen- oder Spaltennamen nutzt, kannst du sie ueber `.env` anpassen, zum Beispiel:

- `SONARA_USERS_TABLE`
- `SONARA_SHIFTS_TABLE`
- `SONARA_TIME_ENTRIES_TABLE`
- `SONARA_ROLE_COLUMN`
- `SONARA_DISCORD_ID_COLUMN`
- `SONARA_SHIFT_DATE_COLUMN`
- `SONARA_SHIFT_START_TIME_COLUMN`
- `SONARA_SHIFT_END_TIME_COLUMN`

## Discord-ID-Voraussetzung

Technisch bindend fuer DMs ist `users.discord_user_id`.

- `discord_name` ist nur Anzeige- und Login-Identifier
- der Bot kann die Discord-ID jetzt selbst nach Sonara zurueckschreiben
- ohne `discord_user_id` funktioniert der Hub weiter
- ohne `discord_user_id` landen Reminder nur im Fallback-Kanal
- Nutzer verknuepfen sich selbst ueber `/verknuepfen`

## Slash-Commands

- `/meine-schichten`
- `/verknuepfen`
- `/einstempeln`
- `/ausstempeln`
- `/ticket`
- `/raum-einladen`
- `/raum-schliessen`
- `/bot-status`
- `/test-benachrichtigung`
- `/panel-posten`

## Deployment auf Render

- `Sonara` und der Bot bleiben getrennte Services
- beide zeigen auf dieselbe `DATABASE_URL`
- `BOT_BASE_URL` sollte auf die oeffentliche Bot-URL zeigen
- keine SQLite-Disk mehr noetig

## Checks

- `npm.cmd run check`
