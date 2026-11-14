PY ?= .venv/bin/python

.PHONY: help venv dev test lint format clean migrations upgrade downgrade \
        run-api worker doctor ingest pull

help:
	@echo "Tessera development commands"
	@echo ""
	@echo "  make venv         - Create .venv with Python 3.12 and install deps"
	@echo "  make dev          - Start postgres (Docker Compose)"
	@echo "  make run-api      - Run the API with auto-reload on :8000"
	@echo "  make worker       - Run the Drive transfer worker in the foreground"
	@echo "  make doctor       - Diagnose config, tiers, queue and database"
	@echo "  make test         - Run tests with coverage"
	@echo "  make lint         - ruff + mypy"
	@echo "  make format       - black + ruff --fix"
	@echo "  make upgrade      - Apply Alembic migrations"
	@echo "  make migrations   - Generate a new Alembic migration (MSG=...)"

venv:
	uv venv --python 3.12 --python-preference only-managed .venv
	uv pip install --python $(PY) -e . pytest pytest-asyncio pytest-cov ruff mypy

dev:
	docker compose up -d postgres
	@echo "PostgreSQL: localhost:5433"

test:
	$(PY) -m pytest

lint:
	$(PY) -m ruff check src/ tests/
	$(PY) -m mypy src/

format:
	$(PY) -m ruff check --fix src/ tests/
	$(PY) -m black src/ tests/

clean:
	docker compose down -v

migrations:
	$(PY) -m alembic revision --autogenerate -m "$(MSG)"

upgrade:
	$(PY) -m alembic upgrade head

downgrade:
	$(PY) -m alembic downgrade -1

run-api:
	$(PY) -m uvicorn mddatalake.api.main:app --reload --host 0.0.0.0 --port 8000

worker:
	$(PY) -m mddatalake.cli.main worker

doctor:
	$(PY) -m mddatalake.cli.main doctor

ingest:
	$(PY) -m mddatalake.cli.main ingest $(DIR) --project $(PROJECT)

pull:
	$(PY) -m mddatalake.cli.main pull $(SRC) --project $(PROJECT)
