FROM python:3.11-slim

WORKDIR /app

# System dependencies. rclone is required by the Google Drive cold tier; the
# official installer is used because Debian's packaged rclone is too old for
# the current Drive API.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    curl \
    ca-certificates \
    postgresql-client \
    tini \
    && curl -fsSL https://rclone.org/install.sh | bash \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Python dependencies
COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN uv pip install --system --no-cache-dir -e .

# Application metadata
COPY alembic.ini /app/
COPY migrations/ /app/migrations/

ENV PYTHONPATH=/app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "mddatalake.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
