# syntax=docker/dockerfile:1.7
# Targets: dev (php.ini de desarrollo) · prod (optimizado, usuario no root, sistema de archivos de solo lectura).
# Servidor: FrankenPHP (`php-server`): un solo proceso (Caddy + PHP), sin php-fpm ni nginx.
FROM dunglas/frankenphp:1.13.2-php8.5-alpine AS base
RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite opcache redis \
 && apk add --no-cache bash git
COPY --from=composer:2.10.2 /usr/bin/composer /usr/bin/composer
# Caddy keeps its config and data under XDG_*: /tmp is the only writable path in prod (tmpfs).
ENV COMPOSER_ALLOW_SUPERUSER=1 XDG_CONFIG_HOME=/tmp/xdg-config XDG_DATA_HOME=/tmp/xdg-data
WORKDIR /app

FROM base AS dev
RUN cp "$PHP_INI_DIR/php.ini-development" "$PHP_INI_DIR/php.ini"
COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/root/.composer/cache composer install --no-interaction --no-scripts --no-autoloader
COPY . .
RUN composer dump-autoload
EXPOSE 8000
CMD ["frankenphp", "php-server", "--listen", ":8000", "--root", "public/"]

FROM base AS vendor
COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/root/.composer/cache \
    composer install --no-dev --no-interaction --no-scripts --no-autoloader --prefer-dist

FROM base AS prod
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && printf 'opcache.validate_timestamps=0\n' > "$PHP_INI_DIR/conf.d/zz-prod.ini" \
 && adduser -D -u 1001 app
COPY --from=vendor /app/vendor ./vendor
COPY . .
# setcap -r: the frankenphp binary ships with a CAP_NET_BIND_SERVICE file capability, and with cap_drop: [ALL]
# the kernel refuses to exec it. Port 8000 does not need it. /app/data is the SQLite volume, owned by the app user.
RUN composer dump-autoload --optimize --classmap-authoritative --no-dev \
 && rm -rf tests \
 && mkdir -p data && chown app:app data \
 && apk add --no-cache libcap-utils && setcap -r /usr/local/bin/frankenphp && apk del libcap-utils
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8000/health >/dev/null || exit 1
CMD ["frankenphp", "php-server", "--listen", ":8000", "--root", "public/"]
