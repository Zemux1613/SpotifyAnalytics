# SpotifyAnalytics

FastAPI-Backend (`backend/`) und Angular-Frontend (`frontend/`).
Nach dem Login mit Spotify siehst du deine Top Artists und Top Tracks und kannst Songs nachschlagen.
Zu jedem gefundenen Song schlägt dir ein trainierter Klassifikator passende Playlists vor und
fügt ihn dort per Klick hinzu.

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
## OpenAPI und Angular-Client generieren

Das FastAPI-Backend ist die Quelle der Wahrheit für den API-Vertrag. Die Angular-Services
und -Models werden daraus mit dem OpenAPI Generator erzeugt und unter
`frontend/src/app/openapi/generated/` abgelegt.

Voraussetzungen: Python 3, Docker und Docker Compose. Das Makefile erstellt für die OpenAPI-Generierung automatisch eine virtuelle Python-Umgebung unter `backend/.venv` und installiert dort die Abhängigkeiten aus `backend/requirements.txt`.

```bash
# OpenAPI-Schema exportieren und Angular-Client generieren
make openapi

# Nur das Schema exportieren bzw. nur den Client neu generieren
make openapi-spec
make openapi-generate

# Entwicklungs- bzw. Produktions-Stack starten
make dev
make prod

# Stack stoppen
make down-dev
make down-prod
```

Die Schema-Generierung benötigt keine echten Spotify-Zugangsdaten. Das Export-Skript setzt
für den Import der FastAPI-Anwendung temporäre Dummy-Werte, falls die Variablen nicht
bereits gesetzt sind. Die generierte API verwendet im Angular-Frontend den Basis-Pfad
`/api`; der bestehende Dev-Proxy entfernt dieses Präfix und leitet die Requests an FastAPI
weiter.

**Hinweis:** Die bestehenden handgeschriebenen Services und Models werden durch diesen
Schritt nicht automatisch ersetzt. Neue bzw. migrierte Aufrufe sollten die generierten
Services aus `src/app/openapi/generated/` verwenden. Damit der Generator aussagekräftige
Models erzeugen kann, sollten Backend-Endpunkte nach Möglichkeit konkrete Pydantic-
Response-Models statt `dict[str, Any]` zurückgeben.
