# syntax=docker/dockerfile:1.7
# Targets: dev (runserver con recarga) · prod (gunicorn, sin dependencias de desarrollo, usuario no root)
# Sin Node ni paso de build de JS: HTMX es un archivo estático fijado en static/vendor/.
ARG PYTHON_VERSION=3.12
ARG UV_VERSION=0.13.4
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM python:${PYTHON_VERSION}-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PROJECT_ENVIRONMENT=/opt/venv \
    DJANGO_SETTINGS_MODULE=src.config.settings \
    PATH="/opt/venv/bin:$PATH"
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app

FROM base AS dev
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS deps-prod
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev

FROM python:${PYTHON_VERSION}-slim AS prod
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=src.config.settings \
    PATH="/opt/venv/bin:$PATH"
RUN useradd --system --uid 1001 --no-create-home app
WORKDIR /app
COPY --from=deps-prod /opt/venv /opt/venv
COPY --chown=app:app . .
# Static files (static/ with the pinned htmx, plus the admin) are collected at build time:
# the container runs read_only and WhiteNoise serves them with hashed names.
# The key below only exists for this RUN (it is not a secret and does not stay in the image environment).
RUN APP_ENV=prod DJANGO_SECRET_KEY=collectstatic-build-only python manage.py collectstatic --noinput \
    && mkdir -p /app/data && chown app:app /app/data
# The SQLite volume (/app/data) takes its owner from the image.
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
# read_only image: the worker heartbeat goes to the /tmp tmpfs, and gunicorn 25+ must not create its control socket.
CMD ["gunicorn", "src.config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--worker-tmp-dir", "/tmp", "--no-control-socket", "--access-logfile", "-"]
