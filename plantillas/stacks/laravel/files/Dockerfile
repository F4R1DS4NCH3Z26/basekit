# syntax=docker/dockerfile:1.7
# Targets: dev (php.ini de desarrollo) · prod (optimizado, usuario no root). Servidor: FrankenPHP (php-server).
FROM dunglas/frankenphp:1-php8.3-alpine AS base
RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache bcmath pcntl redis \
 && apk add --no-cache bash git
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
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
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" && adduser -D -u 1001 app
COPY --from=vendor /app/vendor ./vendor
COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative --no-dev \
 && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
 && chown -R app:app storage bootstrap/cache
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8000/up >/dev/null || exit 1
# optimize cachea config/rutas/vistas con el entorno real del contenedor (correcto en prod; nunca como "verificación")
CMD ["sh", "-c", "php artisan optimize && exec frankenphp php-server --listen :8000 --root public/"]
