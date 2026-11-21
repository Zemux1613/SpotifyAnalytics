.PHONY: help openapi openapi-setup openapi-spec openapi-generate dev prod down-dev down-prod logs-dev logs-prod

# Unter Windows (auch mit GNU Make) den Python Launcher verwenden.
# Unter Linux/macOS python3. Beide Werte lassen sich bei Bedarf überschreiben.
ifeq ($(OS),Windows_NT)
PYTHON ?= py -3
VENV_PYTHON := backend/.venv/Scripts/python.exe
else
PYTHON ?= python3
VENV_PYTHON := backend/.venv/bin/python
endif

COMPOSE := docker compose
OPENAPI_GENERATOR_IMAGE ?= openapitools/openapi-generator-cli:v7.14.0
OPENAPI_SPEC := backend/openapi.json
FRONTEND_API_DIR := frontend/src/app/api/generated

help: ## Zeigt alle verfügbaren Targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-18s %s\n", $$1, $$2}'

openapi: ## Exportiert das FastAPI-Schema und generiert Angular-Services/-Models
	$(MAKE) openapi-spec
	$(MAKE) openapi-generate

openapi-setup: ## Erstellt die Python-venv und installiert Backend-Abhängigkeiten
	@echo "==> Richte Python-Umgebung ein"
	@$(PYTHON) -c "import pathlib, subprocess, sys; venv = pathlib.Path('backend/.venv'); subprocess.check_call([sys.executable, '-m', 'venv', str(venv)]) if not venv.exists() else None"
	@$(VENV_PYTHON) -m pip install --disable-pip-version-check -r backend/requirements.txt

openapi-spec: openapi-setup ## Exportiert das OpenAPI-Schema aus der FastAPI-Anwendung
	@echo "==> Exportiere FastAPI-OpenAPI-Schema"
	@$(VENV_PYTHON) backend/scripts/export_openapi.py

openapi-generate: ## Generiert Angular-Services und -Models aus backend/openapi.json
	@test -f $(OPENAPI_SPEC) || (echo "OpenAPI-Schema fehlt. Bitte zuerst 'make openapi-spec' ausführen." && exit 1)
	@echo "==> Generiere Angular API nach $(FRONTEND_API_DIR)"
	@MSYS_NO_PATHCONV=1 docker run --rm \
		-v "$(CURDIR):/local" \
		$(OPENAPI_GENERATOR_IMAGE) generate \
		-i /local/$(OPENAPI_SPEC) \
		-g typescript-angular \
		-o /local/$(FRONTEND_API_DIR) \
		-c /local/openapi-generator.yaml
	@echo "==> Angular API wurde generiert."

dev: openapi ## Startet Backend und Angular-Frontend mit Hot Reload
	$(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d

prod: openapi ## Baut und startet den produktiven Stack
	$(COMPOSE) up --build -d

down-dev: ## Stoppt den Dev-Stack
	$(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml down

down-prod: ## Stoppt den produktiven Stack
	$(COMPOSE) down

logs-dev: ## Zeigt die Logs des Dev-Stacks
	$(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml logs -f

logs-prod: ## Zeigt die Logs des produktiven Stacks
	$(COMPOSE) logs -f
