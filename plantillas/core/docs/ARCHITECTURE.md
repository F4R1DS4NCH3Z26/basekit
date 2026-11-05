# Arquitectura

## Vista general

```mermaid
flowchart LR
  user([Usuario]) --> app[{{STACK_NAME}}]
  app --> db[(Base de datos)]
```

## Stack
- Runtime: {{STACK_NAME}} en Docker (`Dockerfile`, targets `dev` y `prod`).
- Servicios: ver `compose.yaml` y los overlays `compose.db.yaml` y `compose.redis.yaml`, si existen.

## Estructura de carpetas
Ver la sección de stack en `AGENTS.md`. Aquí solo se documentan las desviaciones y su motivo.

## Módulos y dependencias entre ellos

## Integraciones externas
| Servicio | Para qué | Variables de entorno |
|---|---|---|
