# Auth en Symfony: access tokens opacos (Symfony Security)

Requiere base de datos: usuarios y tokens. `make new-app` ya instaló `symfony/security-bundle` y `symfony/rate-limiter`, y dejó `config/packages/security.yaml` con `/api/**` cerrado (401) hasta que configures el autenticador.

Por qué tokens opacos y no JWT: el servidor guarda solo el hash del token, así que revocar es borrar una fila y un token robado de la BD no sirve. Si de verdad necesitas JWT (varios servicios validan sin BD), escribe una ADR y usa `lexik/jwt-authentication-bundle`.

## Módulo `src/Modules/Auth/` (con `symfony-scaffold Auth`, delegado por roles)

### Domain (data-writer)

```php
// Domain/Entity/User.php
#[ORM\Entity(repositoryClass: UserRepository::class)]
#[ORM\Table(name: 'users')]
#[ORM\UniqueConstraint(columns: ['email'])]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    #[ORM\Id, ORM\Column(type: UuidType::NAME, unique: true)]
    private Uuid $id;
    #[ORM\Column(length: 180)]
    private string $email;
    #[ORM\Column]
    private string $password;                     // hash, nunca el texto plano
    #[ORM\Column(length: 30)]
    private string $role = 'member';              // sin setter público: lo cambia un caso de uso de admin

    public function __construct(string $email, string $passwordHash)
    {
        $this->id = Uuid::v7();
        $this->email = mb_strtolower(trim($email));
        $this->password = $passwordHash;
    }

    public function getId(): Uuid { return $this->id; }
    public function getUserIdentifier(): string { return $this->email; }
    public function getPassword(): string { return $this->password; }
    public function getRoles(): array { return ['ROLE_USER', 'ROLE_'.strtoupper($this->role)]; }
    public function eraseCredentials(): void {}
}
```

```php
// Domain/Entity/AccessToken.php — se guarda el sha256 del token, nunca el token
#[ORM\Entity(repositoryClass: AccessTokenRepository::class)]
#[ORM\Table(name: 'access_tokens')]
class AccessToken
{
    #[ORM\Id, ORM\Column(type: UuidType::NAME, unique: true)]
    private Uuid $id;
    #[ORM\Column(length: 64, unique: true)]
    private string $tokenHash;
    #[ORM\ManyToOne(targetEntity: User::class), ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;
    #[ORM\Column(length: 100)]
    private string $name;                          // dispositivo
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $expiresAt;         // siempre fijado

    public function __construct(User $user, string $tokenHash, string $name, \DateTimeImmutable $expiresAt) { /* asigna */ }
    public function getUser(): User { return $this->user; }
    public function isExpired(\DateTimeImmutable $now): bool { return $this->expiresAt <= $now; }
}
```

`AccessTokenRepository::findOneByHash(string $hash): ?AccessToken` y `deleteAllFor(User $user): void`.

### Application (app-writer)

```php
// Application/Handler/IssueAccessToken.php
final class IssueAccessToken
{
    private const TTL = '+30 days';

    public function __construct(private readonly EntityManagerInterface $em) {}

    /** Devuelve el token en claro una sola vez; en la BD queda su hash. */
    public function handle(User $user, string $device): string
    {
        $plain = bin2hex(random_bytes(32));
        $this->em->persist(new AccessToken($user, hash('sha256', $plain), $device, new \DateTimeImmutable(self::TTL)));
        $this->em->flush();

        return $plain;
    }
}
```

```php
// Application/Security/AccessTokenHandler.php
use Symfony\Component\Security\Core\Exception\BadCredentialsException;
use Symfony\Component\Security\Http\AccessToken\AccessTokenHandlerInterface;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;

final class AccessTokenHandler implements AccessTokenHandlerInterface
{
    public function __construct(private readonly AccessTokenRepository $tokens) {}

    public function getUserBadgeFrom(#[\SensitiveParameter] string $accessToken): UserBadge
    {
        $token = $this->tokens->findOneByHash(hash('sha256', $accessToken));
        if ($token === null || $token->isExpired(new \DateTimeImmutable())) {
            throw new BadCredentialsException('Invalid credentials.');   // 401, mismo mensaje en todos los casos
        }

        return new UserBadge($token->getUser()->getUserIdentifier());
    }
}
```

### Http (http-writer): `POST /api/auth/token`

```php
#[AsController]
#[Route('/api/auth/token', name: 'auth_token', methods: ['POST'])]
final class IssueTokenController
{
    public function __construct(
        private readonly UserRepository $users,
        private readonly PasswordHasherFactoryInterface $hashers,
        private readonly IssueAccessToken $issue,
        private readonly RateLimiterFactory $loginIpLimiter,       // limiter "login_ip"
        private readonly RateLimiterFactory $loginEmailLimiter,    // limiter "login_email"
    ) {}

    public function __invoke(#[MapRequestPayload] IssueTokenRequest $request, Request $http): JsonResponse
    {
        $email = mb_strtolower(trim($request->email));
        // Dos límites independientes: por IP (una IP probando muchos emails) y por cuenta (muchas IPs contra un email).
        foreach ([$this->loginIpLimiter->create('ip:'.$http->getClientIp()), $this->loginEmailLimiter->create('email:'.$email)] as $limiter) {
            if (!$limiter->consume()->isAccepted()) {
                throw new TooManyRequestsHttpException();
            }
        }

        $user = $this->users->findOneBy(['email' => $email]);
        $hasher = $this->hashers->getPasswordHasher(User::class);
        // Sin usuario se verifica contra un hash de relleno: un fallo tarda lo mismo exista o no el email.
        $valid = $hasher->verify($user?->getPassword() ?? $hasher->hash('timing-dummy'), $request->password);
        if ($user === null || !$valid) {
            throw new UnauthorizedHttpException('Bearer', 'Invalid credentials.');   // mensaje genérico
        }

        return new JsonResponse(['token' => $this->issue->handle($user, $request->deviceName), 'type' => 'Bearer'], Response::HTTP_CREATED);
    }
}
```

`IssueTokenRequest`: `email` (`NotBlank`, `Email`, `Length(max: 180)`), `password` (`NotBlank`, `Length(max: 4096)`), `deviceName` con `#[SerializedName('device_name')]` (`NotBlank`, `Length(max: 100)`).

Logout: borra el `AccessToken` actual (o todos con `deleteAllFor`). Registro de usuarios: hashea con `UserPasswordHasherInterface::hashPassword()` y nunca aceptes `role` del cliente.

## Configuración (orquestador)

`config/packages/security.yaml` (reemplaza `users_in_memory`):

```yaml
security:
    providers:
        app_users:
            entity: { class: App\Modules\Auth\Domain\Entity\User, property: email }
    firewalls:
        main:
            lazy: true
            stateless: true
            provider: app_users
            access_token:
                token_handler: App\Modules\Auth\Application\Security\AccessTokenHandler
    access_control:
        - { path: ^/health$, roles: PUBLIC_ACCESS }
        - { path: ^/api/auth/token$, roles: PUBLIC_ACCESS }
        - { path: ^/api, roles: IS_AUTHENTICATED_FULLY }
```

`config/packages/rate_limiter.yaml` (con Redis, el almacenamiento es `cache.app` en Redis; ver `docs/stacks/symfony.md`):

```yaml
framework:
    rate_limiter:
        login_ip: { policy: sliding_window, limit: 10, interval: '1 minute' }
        login_email: { policy: sliding_window, limit: 5, interval: '1 minute' }
```

**Contrapartida del límite por cuenta.** Frenar los intentos por email también permite que alguien bloquee a propósito el login de otra persona. Si te afecta: un límite por cuenta más alto que el de IP, o un captcha o segundo factor tras N fallos.

Roles: `role_hierarchy: { ROLE_ADMIN: [ROLE_USER] }` y comprobaciones con `#[IsGranted('ROLE_ADMIN')]`; la propiedad de cada recurso va en Voters (app-writer).

CORS (si un SPA de otro origen llama a la API): ya está en `src/Core/Http/CorsSubscriber.php` (orquestador). Pon los orígenes explícitos en `CORS_ORIGINS` (separados por coma); nunca `*` con credenciales. Con Bearer tokens no hay cookies, así que no hace falta CSRF.

Después: `make migration NAME=create_auth` y `make migrate`.

## Tests obligatorios (qa-writer)
- Credenciales inválidas: 401 con el mismo mensaje exista o no el email.
- Sexto intento por email en un minuto: 429.
- Token expirado o borrado: 401.
- Ruta protegida sin token: 401.
- Recurso ajeno: 404.
