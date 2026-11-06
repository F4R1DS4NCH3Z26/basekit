# Auth en Spring Boot: Spring Security + JWT (resource server con emisor propio)

Dependencias (ya las incluye `make new-app`): `spring-boot-starter-security` y `spring-boot-starter-oauth2-resource-server`, que trae Nimbus para firmar y verificar.

Si hay un IdP corporativo (Keycloak, Entra ID…), **no emitas tokens**: configura solo `spring.security.oauth2.resourceserver.jwt.issuer-uri` y omite `TokenService`, el login y el refresh.

## `application.yml` (orquestador)

```yaml
app:
  jwt:
    secret: ${JWT_SECRET}
    issuer: ${JWT_ISSUER:app}
    audience: ${JWT_AUDIENCE:app-clients}
    access-ttl: ${ACCESS_TOKEN_TTL:PT15M}
    refresh-ttl: ${REFRESH_TOKEN_TTL:P14D}
  cors-origins: ${CORS_ORIGINS:http://localhost:3000}
management.endpoints.web.exposure.include: health,info
```

## `core/security/CurrentUser.java` y `SecurityConfig.java` (orquestador)

```java
public record CurrentUser(UUID id, Set<String> roles) {}
```

```java
@Configuration
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http
            .csrf(c -> c.disable()) // API sin estado con Bearer: no hay cookie de sesión que proteger
            .cors(Customizer.withDefaults()) // usa el bean llamado `corsConfigurationSource` (ver abajo)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll() // un 500 no se convierte en 401
                .requestMatchers("/error", "/actuator/health", "/api/auth/login", "/api/auth/register", "/api/auth/refresh").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(SecurityConfig::toCurrentUser)))
            .build();
    }

    /** Hace que @AuthenticationPrincipal CurrentUser funcione en los controladores. */
    static AbstractAuthenticationToken toCurrentUser(Jwt jwt) {
        List<String> roles = Optional.ofNullable(jwt.getClaimAsStringList("roles")).orElse(List.of());
        var user = new CurrentUser(UUID.fromString(jwt.getSubject()), Set.copyOf(roles));
        var authorities = roles.stream().map(r -> new SimpleGrantedAuthority("ROLE_" + r)).toList();
        return new UsernamePasswordAuthenticationToken(user, jwt, authorities);
    }

    @Bean
    SecretKey jwtKey(@Value("${app.jwt.secret}") String secret) {
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) throw new IllegalStateException("JWT_SECRET debe tener al menos 32 bytes");
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey key) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(key));
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey key, @Value("${app.jwt.issuer}") String issuer,
                          @Value("${app.jwt.audience}") String audience) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        // Null-safe: un token sin `aud` da 401, no un NPE (500).
        OAuth2TokenValidator<Jwt> aud = new JwtClaimValidator<List<String>>(JwtClaimNames.AUD,
            a -> a != null && a.contains(audience));
        // JwtTimestampValidator acepta un token sin `exp`: se exige aparte.
        OAuth2TokenValidator<Jwt> exp = new JwtClaimValidator<Instant>(JwtClaimNames.EXP, Objects::nonNull);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer), aud, exp));
        return decoder;
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder(); // bcrypt; prefijo {id} permite migrar a argon2
    }

    /** El nombre del método importa: `.cors(...)` busca el bean `corsConfigurationSource`; con otro nombre se ignora y los preflight dan 401. */
    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${app.cors-origins}") List<String> origins) {
        var c = new CorsConfiguration();
        c.setAllowedOrigins(origins);
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
        c.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", c);
        return source;
    }
}
```

## `core/security/TokenService.java` (orquestador)

```java
@Service
public class TokenService {
    private final JwtEncoder encoder;
    private final String issuer, audience;
    private final Duration accessTtl;

    TokenService(JwtEncoder encoder, @Value("${app.jwt.issuer}") String issuer,
                 @Value("${app.jwt.audience}") String audience, @Value("${app.jwt.access-ttl}") Duration accessTtl) {
        this.encoder = encoder; this.issuer = issuer; this.audience = audience; this.accessTtl = accessTtl;
    }

    public String issueAccess(UUID userId, Collection<String> roles) {
        Instant now = Instant.now();
        var claims = JwtClaimsSet.builder().issuer(issuer).audience(List.of(audience)).subject(userId.toString())
            .issuedAt(now).expiresAt(now.plus(accessTtl)).claim("roles", List.copyOf(roles)).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    public static String newRefreshToken() { // opaco; en BD se guarda SHA-256(token)
        byte[] b = new byte[48];
        new SecureRandom().nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
```

## Dominio `auth` (con `java-scaffold auth`, delegado por roles)

**domain-writer**:
- Entidades `UserAccount` (`id`, `email` único en minúsculas, `passwordHash`, `roles`, `enabled`) y `RefreshToken` (`id`, `userId`, `tokenHash` único, `familyId`, `expiresAt`, `revokedAt`).
- Migración `V<n>__create_auth.sql`.

**app-writer**: `AuthService`.
- `login(email, password)`:
  - `DUMMY_HASH` se genera **una vez al arrancar** con el mismo encoder: `passwordEncoder.encode(UUID.randomUUID().toString())`. Así lleva el prefijo `{bcrypt}`/`{argon2}`. Un hash escrito a mano sin prefijo hace que `DelegatingPasswordEncoder.matches` lance `IllegalArgumentException` (500) solo para los emails que no existen, y eso los delata.
  - Siempre ejecuta `passwordEncoder.matches(password, user != null ? user.passwordHash() : DUMMY_HASH)`. Recién después decide: usuario inexistente, cuenta deshabilitada (`!enabled`) o contraseña incorrecta lanzan la misma `InvalidCredentialsException`, con un mensaje único.
- `refresh(raw)`, sin leer y luego escribir, porque dos refresh simultáneos con el mismo token pasarían los dos:
  - Revoca de forma atómica en el repositorio y usa el número de filas afectadas:
    ```java
    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :now where t.tokenHash = :hash and t.revokedAt is null and t.expiresAt > :now")
    int revokeIfActive(@Param("hash") String hash, @Param("now") Instant now);
    ```
  - Dentro de una transacción (`@Transactional`): si `revokeIfActive(sha256(raw), now) != 1`, el token no existe, venció o **ya se usó**. Si existe y estaba revocado, es reutilización: revoca toda su familia (`familyId`). En los tres casos falla con el mismo 401.
  - Si la fila se revocó, carga el usuario y verifica `enabled`. Si la cuenta está deshabilitada, revoca la familia y falla.
  - Solo entonces emite el par nuevo en la misma familia, en la misma transacción.
- `logout(raw)`: revoca ese token.

**web-writer**: `AuthController` en `/api/auth`.

| Endpoint | Respuesta |
|---|---|
| `POST /login` | 200 `TokenPairResponse` |
| `POST /refresh` | 200 `TokenPairResponse` |
| `POST /logout` | 204 |
| `GET /me` | `@AuthenticationPrincipal CurrentUser` |

`GlobalExceptionHandler` (orquestador) traduce `InvalidCredentialsException` → 401 `ProblemDetail` "Credenciales inválidas".

**Rate limit** en `/api/auth/login` y `/refresh` (orquestador): `core/security/AuthRateLimiter.java`, en memoria y sin dependencias. Va en el controlador y no en un filtro porque el email viaja en el cuerpo JSON, que un filtro no puede leer sin consumirlo.

```java
@Component
public class AuthRateLimiter {
    private static final int MAX_ATTEMPTS = 5;
    private static final long WINDOW_MS = Duration.ofMinutes(1).toMillis();
    /** Tope de memoria. Una ventana activa nunca se descarta: si se borrara, su contador volvería a cero. */
    private static final int MAX_KEYS = 100_000;
    private final Map<String, Window> windows = new HashMap<>();
    private long lastPurge;

    private record Window(long start, int hits) {}

    /**
     * Ventana fija por clave. Cada clave de `keys` es un bucket independiente (p. ej. uno por IP y otro por
     * email): basta que uno pase el límite para responder 429. Si la memoria está llena de ventanas
     * activas, las claves nuevas reciben 429 (falla cerrado) en lugar de desalojar contadores vivos.
     */
    public synchronized void check(String... keys) {
        long now = System.currentTimeMillis();
        if (windows.size() >= MAX_KEYS && now - lastPurge >= 1_000) {   // como mucho una purga por segundo
            windows.values().removeIf(w -> now - w.start() >= WINDOW_MS);
            lastPurge = now;
        }
        for (String key : keys) {
            Window old = windows.get(key);
            boolean fresh = old == null || now - old.start() >= WINDOW_MS;
            if (old == null && windows.size() >= MAX_KEYS) throw tooMany();
            Window w = fresh ? new Window(now, 1) : new Window(old.start(), old.hits() + 1);
            windows.put(key, w);
            if (w.hits() > MAX_ATTEMPTS) throw tooMany();   // el primer bucket excedido corta: no crea los siguientes
        }
    }

    private static ResponseStatusException tooMany() {
        return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Demasiados intentos");
    }

    /** La misma normalización que usa AuthService, para que " Ana@x.com" y "ana@x.com" compartan contador. */
    public static String normalizeEmail(String email) {
        return email == null ? "" : email.strip().toLowerCase(Locale.ROOT);
    }
}
```

En `AuthController`:

```java
@PostMapping("/login")
TokenPairResponse login(@Valid @RequestBody LoginRequest body, HttpServletRequest http) {
    // Dos buckets: por IP (una IP probando muchos emails) y por email (muchas IPs contra una cuenta).
    rateLimiter.check("login-ip|" + http.getRemoteAddr(), "login-email|" + AuthRateLimiter.normalizeEmail(body.email()));
    return authService.login(body.email(), body.password());
}

@PostMapping("/refresh")
TokenPairResponse refresh(@Valid @RequestBody RefreshRequest body, HttpServletRequest http) {
    rateLimiter.check("refresh|" + http.getRemoteAddr());   // el refresh es opaco: se limita por IP
    return authService.refresh(body.refreshToken());
}
```

- Detrás de un proxy, `getRemoteAddr()` es la IP del proxy. Activa `server.forward-headers-strategy=native` y fija `server.tomcat.remoteip.internal-proxies` con las IPs del proxy de confianza. Es una expresión regular: escapa los puntos (`10\\.0\\.0\\.5`), o `10.0.0.5` también aceptaría `10a0b0c5`. Nunca leas `X-Forwarded-For` a mano: lo falsifica cualquiera.
- El contador vive en cada instancia. Con varias réplicas, usa el límite del proxy inverso o Bucket4j con Redis (requiere aprobación). Documenta cuál en `docs/AUTH.md`.

## Tests obligatorios (qa-writer)

**Validación del token, con tokens reales.** `jwt()` de `spring-security-test` se salta el `JwtDecoder` y sus validadores, así que no prueba `aud` ni `exp`. Su principal es un `Jwt`, así que `@AuthenticationPrincipal CurrentUser` llega `null`.

- Usa `@WebMvcTest` con `@Import({SecurityConfig.class, TokenService.class})`, o `@SpringBootTest` + `@AutoConfigureMockMvc`.
- Firma tokens con el `JwtEncoder` y el `TokenService` de la app y envíalos como `Authorization: Bearer <token>`:
  - válido (`tokenService.issueAccess(...)`) → 200 en `GET /api/auth/me`, con el `id` del `CurrentUser`;
  - sin token → 401;
  - con otra `aud`, sin `aud` o vencido → 401.
- Preflight `OPTIONS` con `Origin` permitido → 200 con `Access-Control-Allow-Origin`.

```java
String mint(String aud, Instant exp) {   // aud == null: sin `aud`; vencido: exp más de 60 s en el pasado (margen de reloj)
    var builder = JwtClaimsSet.builder().issuer(issuer).subject(UUID.randomUUID().toString())
        .issuedAt(exp.minus(Duration.ofMinutes(15))).expiresAt(exp);
    if (aud != null) builder.audience(List.of(aud));   // List.of(null) lanzaría NPE
    var claims = builder.build();
    return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
}
// mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + mint("otra-app", Instant.now().plusSeconds(600))))
//        .andExpect(status().isUnauthorized());
```

**Autorización.** `jwt()` sirve solo donde no hace falta validar el token: rol insuficiente en `@PreAuthorize` → 403. Si el endpoint usa `@AuthenticationPrincipal CurrentUser`, envía un token real.

**`AuthService` (unitario).**
- Reutilizar un refresh rotado revoca la familia.
- Login con email inexistente y con contraseña incorrecta dan la misma excepción.

**Rate limit.** Sexto login en un minuto con la misma IP y email → 429.
