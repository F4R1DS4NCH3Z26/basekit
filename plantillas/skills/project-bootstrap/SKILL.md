---
name: project-bootstrap
description: "Convierte la descripción de un proyecto (\"esto trata de…\") en la base lista para desarrollar - entrevista de diseño, decisión de base de datos y autenticación con ADRs, documentación inicial, infraestructura Docker activada y módulo de auth planificado. Úsala SIEMPRE que docs/PROJECT.md diga \"Estado: sin definir\", cuando el usuario describa un proyecto nuevo o pida \"inicializa\", \"arranca\" o \"crea la base del proyecto\"."
---

# project-bootstrap

Objetivo: que el usuario solo tenga que contar de qué trata el proyecto. Tú haces las preguntas, propones respuestas, decides con él y dejas todo documentado y funcionando en Docker.

Lee primero `.agents/manifest.json` (stack y opciones del CLI) y `docs/PROJECT.md` (puede traer un contexto inicial).

## Paso 1 · Entrevista (grilling + domain-modeling)

Aplica las skills `grilling` y `domain-modeling` (juntas son lo que el usuario invoca como `grill-with-docs`). Si tu herramienta no las carga, lee sus `SKILL.md` en `.agents/skills/`.

Tu árbol de diseño **debe** cubrir estas ramas. Propón siempre tu respuesta recomendada usando las tablas de `references/`:

1. Qué es y para quién: actores, roles y qué hace cada uno.
2. Alcance de la v1 y no-objetivos.
3. **Datos**: ¿qué se guarda?, ¿quién lo crea?, ¿cuánto vive? → ¿hace falta base de datos? ¿Cuál? (`references/database.md`)
4. **Identidad**: ¿quién inicia sesión y desde qué cliente (web, SPA, móvil, otros servicios)? ¿Social, SSO o MFA? (`references/auth.md`)
5. Integraciones externas (pagos, correo, almacenamiento) y sus secretos.
6. Despliegue: VPS con Docker Compose o plataforma gestionada; ¿BD gestionada en prod?
7. Módulos o features iniciales (máximo 3–5 para la v1).

Los hechos los averiguas tú (lee el repo, el `.agents/manifest.json`); las decisiones son del usuario. No avances hasta que el usuario confirme que hay entendimiento compartido.

## Paso 2 · Documentar decisiones

- Llena `docs/PROJECT.md` y cambia `Estado: sin definir` → `Estado: definido`.
- Escribe en `GLOSSARY.md` los términos resueltos, siguiendo el formato de `domain-modeling`.
- Escribe una ADR por cada decisión difícil de revertir, con el formato de `domain-modeling`: `docs/adr/NNNN-slug.md`. Como mínimo una para la base de datos y otra para la autenticación, aunque la decisión sea "sin BD" o "sin auth".
- Completa `docs/AUTH.md` (método, flujos, roles) y `docs/ARCHITECTURE.md` (diagrama mermaid real).

## Paso 3 · Infraestructura

```bash
bash .agents/skills/infra-setup/scripts/infra.sh --db <postgres|mysql|sqlite|none> [--redis]
make env && make dev        # debe levantar y responder en http://localhost:<PORT>
```

En un proyecto combinado (`backend/` + `frontend/`), la base de datos es del backend: usa su copia, `bash backend/.agents/skills/infra-setup/scripts/infra.sh …`, desde la raíz.

Si `make dev` falla, corrige la configuración antes de seguir. Docker y el `Makefile` son tu zona como orquestador. Si Docker no está disponible en tu entorno, dile al usuario qué comando ejecutar y espera su resultado.

## Paso 4 · Autenticación

1. Instala las dependencias de auth que indique `references/auth.md` para el stack. **Pide confirmación** al usuario antes de agregarlas.
2. Configura el núcleo de auth (zona del orquestador: `src/lib/`, `src/core/`, `config/` o `core/security`) siguiendo la skill `<stack>-patterns`, en su archivo `references/auth.md`.
3. Crea el módulo de usuarios o auth con la skill `<stack>-scaffold` y su contrato. Delega los roles según `AGENTS.md`.
4. Agrega las variables nuevas a `.env.example` (secretos como `__GENERATE__`).

## Paso 5 · Módulos iniciales

Por cada módulo de la v1: scaffold → contrato `Estado: cerrado` (validado con el usuario) → delegación por roles. Si el usuario prefiere, deja solo los contratos y termina aquí.

## Paso 6 · Cierre

```bash
make verify && make test
bash .agents/skills/zone-check/scripts/check_zones.sh --owners
```

Actualiza `README.md` (la línea de descripción y el puerto) y responde al usuario con:

1. Las decisiones tomadas, con enlace a cada ADR.
2. Los comandos para arrancar.
3. Lo que quedó pendiente.

## No hagas

- Elegir la BD o el método de auth sin preguntar: recomienda y espera.
- Instalar un toolchain en el host o levantar servicios fuera de Docker.
- Leer o mostrar `.env` o `.env.prod`.
- Saltarte las ADRs "porque la decisión es obvia": dentro de seis meses no lo será.
