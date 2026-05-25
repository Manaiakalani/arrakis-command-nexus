FROM python:3.12.10-slim-bookworm AS builder
WORKDIR /build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12.10-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    gzip \
    gnupg \
    && echo "deb http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
    && groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app --shell /usr/sbin/nologin app \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /install /usr/local
COPY . .
RUN chmod +x /app/scripts/*.sh 2>/dev/null || true \
    && chown -R app:app /app \
    && mkdir -p /workspace/data \
    && chown app:app /workspace/data
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
