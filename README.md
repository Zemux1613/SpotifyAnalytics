# SpotifyAnalytics

FastAPI-Backend (`backend/`) und Angular-Frontend (`frontend/`).
Nach dem Login mit Spotify siehst du deine Top Artists und Top Tracks und kannst Songs nachschlagen.
Zu jedem gefundenen Song schlägt dir ein trainierter Klassifikator passende Playlists vor und
fügt ihn dort per Klick hinzu.

# Playlist-Empfehlungen
- Das Backend liest deine Playlists (`/me/playlists`) und deren Tracks (`/playlists/{id}/tracks`)
  sowie die Genres der Künstler (`/artists`).
- Pro Playlist wird ein Random-Forest-Klassifikator trainiert (Genres + Track-Metadaten).
  Die Ausgabe ist die geschätzte Passgenauigkeit in Prozent.
- Das Modell wird beim ersten Vorschlag aufgebaut und 30 Minuten im Speicher gecacht.
  Der Button „Neu berechnen“ baut es neu auf.
- Berücksichtigt werden nur Playlists, die dir gehören oder kollaborativ sind – nur dort
  funktioniert das Hinzufügen per Spotify-API.
- Nach dieser Änderung sind neue Spotify-Scopes nötig: einmal abmelden und neu anmelden.

# Einmalig einrichten
1. Im [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) eine App anlegen.
2. Redirect-URI eintragen: `http://127.0.0.1:8000/callback` (`127.0.0.1`, nicht `localhost`).
3. Unter "User Management" alle Accounts eintragen, die sich anmelden sollen (Development Mode: maximal 5).
4. `backend/.env.example` nach `backend/.env` kopieren und Client ID und Secret eintragen.

# Starten
```bash
# Backend (Docker)
docker compose up -d --build
# oder mit Hotreload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Frontend
cd frontend
npm install
npm start
```
Das Frontend öffnest du unter **http://127.0.0.1:4200** (nicht `localhost`, sonst wird das Session-Cookie nicht mitgeschickt).
Der Dev-Server leitet `/api/...` an das Backend auf Port 8000 weiter (`frontend/proxy.conf.json`).