"""Exportiert das von FastAPI zur Laufzeit erzeugte OpenAPI-Schema."""

import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent

# create_app() validiert die Spotify-Zugangsdaten bereits beim Import.
# Für die reine Schema-Generierung werden keine echten Zugangsdaten benötigt.
os.environ.setdefault("SPOTIFY_CLIENT_ID", "openapi-generation")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "openapi-generation")

sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402


def main() -> None:
    output = BACKEND_DIR / "openapi.json"
    schema = app.openapi()
    output.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"OpenAPI-Schema exportiert: {output.relative_to(ROOT_DIR)}")


if __name__ == "__main__":
    main()
