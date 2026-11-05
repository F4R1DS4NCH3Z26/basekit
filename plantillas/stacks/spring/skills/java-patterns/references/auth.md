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
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/actuator/health", "/api/auth/login", "/api/auth/register", "/api/auth/refresh").permitAll()
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
        OAuth2TokenValidator<Jwt> aud = jwt -> jwt.getAudience().contains(audience)
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "aud inválido", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer), aud));
        return decoder;
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder(); // bcrypt; prefijo {id} permite migrar a argon2
    }

    @Bean
    CorsConfigurationSource cors(@Value("${app.cors-origins}") List<String> origins) {
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
  - Si el usuario no existe, ejecuta `passwordEncoder.matches(password, DUMMY_HASH)` para que el tiempo sea el mismo.
  - Lanza `InvalidCredentialsException` con un mensaje único.
- `refresh(raw)`:
  - Busca por `sha256(raw)`.
  - Si está vencido o no existe → inválido.
  - Si ya estaba revocado → revoca toda la familia (`familyId`) y falla.
  - Si no, lo revoca y emite un par nuevo en la misma familia.
- `logout(raw)`: revoca ese token.

**web-writer**: `AuthController` en `/api/auth`.

| Endpoint | Respuesta |
|---|---|
| `POST /login` | 200 `TokenPairResponse` |
| `POST /refresh` | 200 `TokenPairResponse` |
| `POST /logout` | 204 |
| `GET /me` | `@AuthenticationPrincipal CurrentUser` |

`GlobalExceptionHandler` (orquestador) traduce `InvalidCredentialsException` → 401 `ProblemDetail` "Credenciales inválidas".

**Rate limit** en `/api/auth/login` y `/refresh`: Bucket4j (requiere aprobación) o el proxy inverso. Documenta cuál en `docs/AUTH.md`.

## Tests obligatorios (qa-writer)
- `@WebMvcTest` con `jwt()` de `spring-security-test`: sin token → 401; token con otra `aud` o vencido → 401; con rol insuficiente en `@PreAuthorize` → 403.
- `AuthService` (unitario): reutilizar un refresh rotado revoca la familia; login con email inexistente y con contraseña incorrecta dan la misma excepción.
