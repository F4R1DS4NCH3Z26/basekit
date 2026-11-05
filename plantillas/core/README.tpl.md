# {{PROJECT_NAME}}

> {{ONE_LINER}}

## Requisitos
Docker con Compose v2, GNU Make, Git y OpenSSL. En Windows, usa WSL2. No hace falta instalar {{STACK_NAME}} en tu máquina.

## Arranque rápido (desarrollo)

```bash
make env      # crea .env con secretos aleatorios (una sola vez)
make dev      # construye y levanta → http://localhost:{{PORT}}
make migrate  # aplica migraciones (si hay base de datos)
make test
```

`make help` lista todos los comandos.

## Producción

```bash
make env ENV=prod   # crea .env.prod; revisa los valores marcados con CAMBIAR
make prod-up
make prod-migrate
```

Detalles de despliegue, backups y rotación de secretos: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Documentación
- [Qué es y para quién](docs/PROJECT.md) · [Arquitectura](docs/ARCHITECTURE.md) · [Autenticación](docs/AUTH.md) · [Operación](docs/RUNBOOK.md)
- Vocabulario del dominio: [GLOSSARY.md](GLOSSARY.md) · Decisiones: [docs/adr/](docs/adr/)
- Para agentes de IA: [AGENTS.md](AGENTS.md)
