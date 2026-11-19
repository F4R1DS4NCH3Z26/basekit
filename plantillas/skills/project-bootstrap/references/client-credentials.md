# Autenticación entre servicios (client credentials + JWT)

Úsala solo cuando los clientes de la API son **otros servicios**, sin usuarios que inicien sesión: integraciones, workers o backends de terceros. Si también hay usuarios, aplica `auth.md` para ellos y esta guía solo para los clientes de máquina, y registra ambas cosas en la ADR de auth y en `docs/AUTH.md`.

Porta la **lógica**, no el código: adáptala al framework y a las capas del stack (`<stack>-patterns/references/auth.md`). Trabaja con TDD: un test que falle por cada regla, y que pase por la interfaz HTTP pública verificando status, cuerpo y headers.

## 1. Flujo
- `POST /auth/token` con JSON `{"client_id", "client_secret"}` → `200 {"access_token", "token_type": "bearer", "expires_in"}`.
- Las rutas protegidas exigen `Authorization: Bearer <jwt>`. Las públicas (health, docs) no.

## 2. Registro de clientes (solo hashes, nunca secretos)
- Variable `API_CLIENTS=client_id:<hash>,otro:<hash>`. Cada entrada se separa en el **primer** `:`.
- Hash: `pbkdf2_sha256:<iteraciones>:<salt>:<digest>`, con salt de 16 bytes y digest de 32 bytes en base64url **sin** padding. Usa `:` y nunca `$`, porque Docker Compose interpreta `$` en los archivos de entorno.
- Iteraciones: entre 100000 y 2000000 (por defecto 600000, la cifra de OWASP) y **las mismas** para todos los clientes. Si difieren, el tiempo de respuesta revela qué `client_id` existen.
- Al arrancar, la app rechaza:
  - entradas sin `:`;
  - ids vacíos o duplicados;
  - hashes mal formados;
  - iteraciones fuera de rango o distintas entre clientes;
  - secretos en texto plano.

  Los mensajes de error nombran solo el `client_id`, nunca el valor.

## 3. Verificación del secreto
- Exactamente **un** PBKDF2 por intento. Si el id no existe, compara contra un hash ficticio con las mismas iteraciones y con salt y digest aleatorios en cada llamada, así el tiempo no revela qué ids existen.
- Compara con una función de tiempo constante: `hmac.compare_digest`, `crypto.timingSafeEqual`, `subtle.ConstantTimeCompare`, `hash_equals` o `MessageDigest.isEqual`.
- PBKDF2 consume mucha CPU: córrelo fuera del event loop (handler síncrono, threadpool o worker).
- Error: `401 {"detail": "Invalid client credentials"}` con `WWW-Authenticate: Bearer`.

## 4. Emisión del JWT
- HS256 con estos claims exactos: `sub` (el client_id), `iss` y `aud` (el nombre del servicio), `iat` y `exp = iat + TTL`.
- TTL configurable entre 60 y 900 s (por defecto 900), igual que la regla común de `auth.md` (access de 15 min o menos). No hay refresh token: al vencer, el cliente pide otro con sus credenciales.
- El secreto de firma es `JWT_SECRET`, de al menos 256 bits (64 caracteres hex). Lo genera `make env` (`__GENERATE__`) y la app rechaza al arrancar uno más corto.

## 5. Verificación del JWT (en este orden)
1. Más de 8192 caracteres → inválido.
2. No cumple exactamente `[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` (coincidencia completa) → inválido.
3. Librería JWT:
   - Solo acepta HS256.
   - Verifica la firma, `iss` y `aud`, y exige `sub`, `iss`, `aud`, `iat` y `exp`.
   - Desactiva **sus** chequeos de `exp` e `iat` (se hacen más abajo) y deja **activo** el de `nbf`.
   - Cualquier excepción, error de tipo o recursión → inválido.
4. `sub` no es un string no vacío, o `iat`/`exp` no son números finitos (un booleano no cuenta) → inválido.
5. `iat` en el futuro → inválido.
6. `sub` ya no está en `API_CLIENTS` → inválido. Así un cliente se revoca de inmediato.
7. Recién al final, `exp <= ahora` → **expirado**. "Expirado" solo se informa para un token que en todo lo demás es válido.

Los mensajes nunca incluyen el token ni la clave.

## 6. Respuestas 401 de las rutas protegidas
| Caso | `detail` | `WWW-Authenticate` |
|---|---|---|
| Sin header, vacío o con un esquema distinto de Bearer | `Missing bearer token` | `Bearer` |
| `access_token` en la query, aunque el header sea válido (se revisa **primero**) | `Invalid bearer token` | `Bearer error="invalid_token"` |
| Token inválido | `Invalid bearer token` | `Bearer error="invalid_token"` |
| Token expirado | `Expired bearer token` | `Bearer error="invalid_token", error_description="The token expired"` |

## 7. Límite de intentos en `/auth/token`
- Con un solo proceso, el límite puede vivir en la app.
- Con varios workers o réplicas, un contador en memoria no se comparte. Hazlo en el proxy inverso o en Redis (`compose.redis.yaml`).
- Con nginx, por ejemplo: `limit_req_zone $binary_remote_addr zone=<svc>_token:10m rate=5r/m;` y, en un `location = /auth/token` que conserve los headers de proxy, `limit_req zone=<svc>_token burst=5 nodelay; limit_req_status 429;`.
- Documenta los números reales en `docs/AUTH.md`. Con `burst=5 nodelay` pasan 6 peticiones seguidas y después 1 cada 12 s.

## 8. Alta de clientes
- Agrega al `.make/stack.mk` del proyecto un objetivo `make client CLIENT=<id>`. Ese archivo es del proyecto: `basekit sync` nunca lo reescribe.
- El objetivo:
  - valida el id con `[A-Za-z0-9._-]{1,64}`;
  - genera un secreto aleatorio y lo guarda en `secrets/clients/<id>.secret` (permisos 600);
  - agrega solo su hash a `API_CLIENTS` en `.env` (o en `.env.prod` con `ENV=prod`).
- **Nunca** imprime un secreto ni un hash: solo dice qué hizo y dónde quedó cada archivo.
- Nunca sobrescribe un secreto ni un valor existente. Valida todo antes de escribir, y si una escritura falla, borra lo que creó en esa corrida.
- Pasa `CLIENT` por variable de entorno (`client: export CLIENT := $(CLIENT)` y `"$$CLIENT"` en la receta). Nunca lo interpoles en la receta: eso permite inyectar comandos.
- `secrets/` va en `.gitignore` y en `.dockerignore`.

## 9. Secretos como archivos (opcional, con ADR)
Por defecto, basekit pasa los secretos por `.env`/`.env.prod` (`make env`, permisos 600). Si el despliegue exige que no aparezcan en `docker inspect` ni en `/proc/<pid>/environ`, regístralo en una ADR y usa archivos:
- La configuración acepta `NAME` o `NAME_FILE`. Si llegan los dos, la app no arranca. Si el archivo no se puede leer → `NAME_FILE: cannot read <ruta>`. Al contenido se le quita el salto de línea final.
- Compose ignora `uid`, `gid` y `mode` de los secretos fuera de Swarm, y monta el archivo con el modo del host. Como la app de prod corre sin root (uid 1001), usa una carpeta `secrets/` con permisos 700 y archivos con 644. Con 600, la app no arranca en Linux. Verifícalo en Linux, no solo en Docker Desktop.
- Rotar un archivo no cambia el compose: `docker compose up` necesita `--force-recreate` para montar el archivo nuevo.

## 10. Tests mínimos
- El token emitido tiene exactamente esos claims y cumple `exp - iat == TTL`.
- 401 para un secreto incorrecto, un id desconocido y el secreto de otro cliente.
- `Missing` sin header. `Invalid` para un token falsificado, con otro algoritmo, con `alg: none`, sin `aud` o con un `aud` incorrecto, con `iat` o `nbf` en el futuro, demasiado largo, mal formado, de un cliente revocado, o con `?access_token=`.
- Expirado y válido → `Expired`; expirado y falsificado → `Invalid`.
- Configuración: un test por cada rechazo de `API_CLIENTS`; ningún error muestra un valor.
- `make client`: crea los archivos con sus permisos; una segunda corrida no cambia nada; nunca imprime un secreto.

## 11. Documentación
En `docs/AUTH.md` y `docs/RUNBOOK.md`, documenta:
- cómo dar de alta un cliente (`make client CLIENT=<id>`);
- qué recibe cada consumidor: el `client_id` y el secreto de `secrets/clients/<id>.secret`, entregado por un gestor de contraseñas o un enlace de un solo uso;
- cómo rotarlo y cómo revocarlo (quitarlo de `API_CLIENTS` y reiniciar);
- cómo respaldar los secretos (cifrados, por ejemplo con `age`);
- la tabla de errores de la sección 6.
