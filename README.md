# SpotifyAnalytics

Webanwendung zur Analyse deiner Spotify-Hörgewohnheiten mit **FastAPI-Backend** (`backend/`) und **Angular-Frontend** (`frontend/`).

Nach dem Login mit deinem Spotify-Account bietet die App folgende Funktionen:
* **Dashboard & Hörgewohnheiten:** Auswertung deiner Hörzeit (heute & diese Woche), Hörserien (Streaks), Neuentdeckungen, stündlicher Aktivitäts-Heatmap sowie der Ø-BPM deiner Top-Tracks.
* **Top-Listen:** Übersicht deiner meistgehörten Artists und Tracks für verschiedene Zeiträume (4 Wochen, 6 Monate, 1 Jahr).
* **Song-Suche & Playlist-Empfehlungen:** Songs nachschlagen, Audio-Features einsehen und mithilfe eines trainierten Klassifikators passende eigene Playlists vorschlagen lassen, um Tracks per Klick hinzuzufügen.

---

## Einmalig einrichten

1. Im [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) eine neue App anlegen.
2. Als Redirect-URI exakt `http://127.0.0.1:8000/callback` eintragen (`127.0.0.1` verwenden, nicht `localhost`).
3. Unter **User Management** alle Spotify-Accounts hinterlegen, die sich anmelden dürfen (im Development Mode maximal 5 Accounts).
4. Die Beispieldatei `backend/.env.example` nach `backend/.env` kopieren und dort `CLIENT_ID`, `CLIENT_SECRET` sowie die weiteren Konfigurationswerte eintragen.

---

## Starten

### Über das Makefile (empfohlen)

```bash
# Entwicklungs-Stack starten (Backend + Frontend mit Hot-Reload)
make dev

# Produktions-Stack starten (inkl. Nginx für das Frontend)
make prod

# Laufende Stacks stoppen
make down-dev
make down-prod