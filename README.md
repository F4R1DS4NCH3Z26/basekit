# basekit

CLI que prepara la base de un proyecto para trabajar con agentes de código (Claude Code, OpenCode, Codex, Cursor, Gemini CLI, Copilot, Hermes): `AGENTS.md`, roles y zonas en `.agents/`, Docker + `Makefile` para dev y prod, y la documentación inicial. El CLI **prepara**; el agente **decide** (base de datos, auth) con la skill `project-bootstrap`.

La especificación completa está en `docs/spec/` (`00_LEEME.md` … `05_bootstrap_bd_auth.md`), y las guías por stack en `docs/stacks/`. Las plantillas que copia el CLI están en `plantillas/`: el código no tiene nada específico de un stack.

## Requisitos

Node ≥ 20 (sin dependencias en tiempo de ejecución) y git. Para usar el proyecto generado: Docker con Compose v2, GNU Make y OpenSSL.

## Instalación

Se instala desde este repositorio (todavía no está publicado en npm). El repositorio incluye el CLI ya compilado (`dist/src`), así que instalar no compila nada.

**Con el instalador** (recomendado): ejecútalo una vez sin instalarlo y te pregunta dónde lo quieres.

```bash
npx github:F4R1DS4NCH3Z26/basekit
# basekit — ¿cómo quieres instalarlo?
# ❯ Global         un `basekit` para todos tus proyectos (npm install -g)
#   Este proyecto  devDependency del package.json de este directorio (npm install -D)
#   ↑/↓ mover · Enter elegir
```

Los menús se mueven con ↑/↓ (o `k`/`j`), un número del 1 al 9 salta a esa opción y Enter elige. Si una opción no entra en el ancho de la terminal, su descripción se recorta con «…». En la elección de agentes, espacio marca y desmarca. Ctrl+C, Ctrl+D o Esc cancelan y salen con código 130, igual que si se cierra la terminal. Si la entrada no es una terminal (redirigida, CI), los mismos menús se responden con el número de la opción.

Si eliges "Este proyecto" y no hay `package.json`, pregunta antes de crearlo (en un proyecto Python, PHP o Java suele convenir la instalación global). Después ofrece preparar el proyecto con `init`. Sin terminal (CI, scripts) usa `basekit install --global` o `basekit install --project`. `--from` instala otro origen: un fork, una etiqueta o un `.tgz`.

A mano también funciona:

**Global**: un `basekit` para todos tus proyectos.

```bash
npm install -g --install-links github:F4R1DS4NCH3Z26/basekit
basekit init mi-proyecto --stack nextjs --context "Reservas de canchas de pádel"
```

**Por proyecto**: queda fijado en las `devDependencies` del proyecto y cada equipo usa la misma versión.

```bash
npm install -D github:F4R1DS4NCH3Z26/basekit
npx --no-install basekit init . --stack nextjs
```

> **Nunca uses `npx basekit` a secas.** El nombre `basekit` en npm es de otro paquete, y `npx` sin instalación local lo descargaría y lo ejecutaría. `npx --no-install basekit` usa solo la instalación local o la global, y si no encuentra ninguna falla sin descargar nada. Es lo que escriben `AGENTS.md` y los adaptadores generados.

### Windows

Hay dos formas, según dónde vayas a trabajar:

1. **Dentro de WSL2 (recomendado).** Los proyectos que genera basekit corren con Docker y `make`, y en Windows eso se hace en WSL2 (Docker Desktop con el backend de WSL2). Abre tu distribución de WSL e instala basekit ahí con los mismos comandos de Linux. Todo, `init` y también `make dev`, queda en el mismo entorno.
2. **En PowerShell (Windows nativo).** Sirve para instalar y preparar proyectos (`init`, `sync`, `doctor`). Para `make` y Docker igual necesitas WSL2. Requiere [Node.js 20 o superior](https://nodejs.org) y [Git for Windows](https://git-scm.com/download/win), autenticado con una cuenta que tenga acceso al repositorio.

   ```powershell
   npx github:F4R1DS4NCH3Z26/basekit                                   # el instalador: global o este proyecto
   npm install -g --install-links github:F4R1DS4NCH3Z26/basekit        # o global, directo
   basekit init C:\proyectos\mi-app --stack nextjs
   ```

Detalles que ya están resueltos para Windows:

- **Finales de línea.** Git for Windows convierte LF en CRLF al clonar (`core.autocrlf=true`), y CRLF rompe los scripts, el `Makefile` y los `.env` dentro de WSL y Docker (`bash: $'\r': command not found`). El `.gitattributes` de basekit fuerza LF en sus plantillas, e `init` le deja al proyecto generado su propio `.gitattributes` con `* text=auto eol=lf`. Si un proyecto viejo ya tiene CRLF, ejecuta `git add --renormalize .` y commitea.
- **Enlaces de skills.** Si Windows no permite crear enlaces simbólicos (sin modo desarrollador), basekit copia la carpeta y lo avisa en la salida.
- **`npm` y `npx`** se ejecutan a través de sus `.cmd`, con argumentos validados.

El CI prueba todo esto en `windows-latest` con `core.autocrlf=true`: el instalador vía `npx`, `init`, `sync`, la instalación por proyecto y que no quede ningún CRLF en lo que corre dentro de WSL o Docker.

## Uso

```bash
basekit init mi-proyecto --stack nextjs --context "Reservas de canchas de pádel"
basekit stacks        # stacks y agentes soportados
```

Opciones de `init`: `--stack <id>` (o `<backend>+<frontend>`), `--agents a,b`, `--context`, `--db auto|postgres|mysql|sqlite|none`, `--redis`, `--no-external-skills`, `--force`, `--dry-run`, `-y/--yes`. Detalle en `basekit help`.

### Stacks

| Tipo | Lenguaje | `--stack` |
|---|---|---|
| Backend | Go | `gin`, `go-native` |
| Backend | Java | `spring` |
| Backend | PHP | `symfony`, `php-native` |
| Backend | Python | `fastapi`, `django`, `flask`, `python-native` |
| Backend | TypeScript | `nestjs`, `express`, `node-native` |
| Frontend | TypeScript | `react`, `vue`, `vanilla-ts` |
| Fullstack | PHP | `laravel` |
| Fullstack | Python | `django-htmx` |
| Fullstack | TypeScript | `nextjs` |

Los `*-native` (y `vanilla-ts`) no usan framework web. Cada stack se describe en `plantillas/stacks/<id>/stack.json` (`kind`, `language`, `name`…) y en su guía `docs/stacks/<id>.md`. Un stack frontend no tiene base de datos: `init` rechaza `--db` (salvo `auto` o `none`) y `--redis`. `express`, `django-htmx` y los nativos nunca se detectan solos: se eligen con `--stack` o en la pregunta.

### Fullstack combinado: backend + frontend

Además de los fullstack integrados, puedes combinar un backend con un frontend en un monorepo: `--stack <backend>+<frontend>` (en la pregunta: Fullstack → «Combinar backend + frontend»).

```bash
basekit init mi-app --stack fastapi+react --db postgres --redis
cd mi-app && make env && make new-app && make dev   # levanta los dos
```

- `backend/` y `frontend/` son cada uno un proyecto completo de su stack (su `Makefile`, `Dockerfile`, `compose*.yaml` y `.env.example`) y funcionan solos: `make -C backend dev`, `make -C frontend new-app`.
- La raíz tiene lo común una sola vez (`AGENTS.md` con las dos secciones, `.agents/`, adaptadores y `docs/`) y un `Makefile` que delega en los dos: `make dev` (en paralelo), `make test`, `make verify`, `make logs`, `make down`… `make help` los lista.
- El frontend llama a la API por el host (`VITE_API_URL=http://127.0.0.1:<puerto del backend>`) y el backend permite ese origen en `CORS_ORIGINS`. `express`, `node-native`, `php-native` y `symfony` no traen CORS: `init` lo avisa.
- `--db` y `--redis` van al backend. Los roles llevan el prefijo de su lado (`backend-data-writer`, `frontend-ui-writer`) y sus zonas están bajo `backend/` y `frontend/`.
- Solo vale un stack backend seguido de uno frontend: `react+fastapi`, `fastapi+django` o `nextjs+react` son errores de uso.

Cada acción se reporta con `+` (creado), `~` (actualizado), `=` (existía, se conserva) o `!` (aviso). Ejecutarlo dos veces no cambia nada la segunda vez.

## Estado

| Parte | Estado |
|---|---|
| `stacks`, `init`, `sync`, `doctor` | Hecho (pruebas de aceptación 1–11) |
| Adaptadores (Claude Code, OpenCode, Gemini CLI, Hermes) y enlaces de skills | Hecho |
| Skills externas fijadas (`grill-me`, `grill-with-docs`, `grilling`, `domain-modeling`) | Hecho |
| Prueba 9 (`docker compose config` con overlays) | Pasa en `npm test` si hay Docker |
| Prueba 12 (`make new-app` + `make dev` reales) | `scripts/e2e.sh <stack> [db]`; el CI la corre en todos los stacks (Spring con `postgres`; los frontend sin base de datos). Pasa en `fastapi`, `laravel`, `nextjs` y `spring`; en los demás falta su primera corrida con Docker |

## Comandos

- `init [dir]`: crea la base. Sin flags reutiliza lo guardado en `.agents/manifest.json`; `infra.sh` solo corre si pasas `--db`. En una terminal (sin `-y`) pregunta solo lo que no resolvió con flags, manifest o detección: el stack en tres pasos (tipo de app → lenguaje → framework; un paso con una sola opción se elige solo y se anuncia; en Fullstack, «Combinar backend + frontend» pregunta lenguaje y framework de cada lado), los agentes (casillas: espacio marca, Enter confirma; arrancan marcados `claude-code` y `opencode`) y, en la primera corrida, de qué trata el proyecto.
- `sync [dir] [--agents a,b] [--no-external-skills] [--dry-run]`: regenera el bloque de `AGENTS.md`, los subagentes de `.claude/agents/` y `.opencode/agents/` desde `.agents/roles/` y `.agents/zones/`, y los enlaces de skills. Con `--agents`, los agentes nuevos reciben adaptadores, enlaces y skills externas.
- `doctor [dir]`: imprime `OK` o `FALTA` con la sugerencia; sale con código 1 si falta algo. Nunca lee `.env`.

## Estructura

```text
src/
├── cli.ts          solo enruta: flags → comando
├── commands/       un slice por comando (init, sync, doctor, stacks); afuera solo se importa su index.ts
├── kit/            reglas del kit compartidas: stacks, adaptadores, manifest, AGENTS.md, skills externas, Project
├── infra/          puertos de I/O con su implementación real: FileSystem (disco) y Runner (procesos)
└── ui/             preguntas interactivas
tests/              espejo de src/ (commands/, kit/, ui/), más plantillas/ (Makefile y compose) y architecture.test.ts
docs/spec/          la especificación v3 (00_LEEME.md … 05_bootstrap_bd_auth.md); docs/stacks/: guías por stack
```

Las dependencias van en un solo sentido: `cli → commands → kit → infra`. Un comando nunca importa a otro, y `kit` nunca importa `commands`. `tests/architecture.test.ts` lo hace cumplir, y también que `src/` no nombre ningún stack. Todo lo que se escribe en el proyecto destino pasa por `kit/project.ts`: no sale del proyecto, no reescribe lo que no cambió, `--dry-run` no escribe nada y nunca lee `.env`.

## Desarrollo

```bash
npm install
npm test                    # compila con tsc y corre node --test (las pruebas de compose se ejecutan si hay Docker)
npm run compile && bash scripts/e2e.sh nextjs            # prueba 12 real (necesita Docker; la usa el CI)
bash scripts/e2e.sh spring postgres                     # con base de datos (Spring la necesita para arrancar)
```

`dist/src` se commitea: después de cambiar `src/`, ejecuta `npm run compile` y commitea `dist/src` junto con el cambio. El CI falla si no coinciden.

No agregues a `package.json` scripts llamados `build`, `install`, `preinstall`, `postinstall`, `prepack` o `prepare`. Con cualquiera de ellos, npm "prepara" el paquete al instalarlo desde git y la instalación global se rompe. Por eso el script de compilación se llama `compile`, y `tests/packaging.test.ts` lo vigila.
