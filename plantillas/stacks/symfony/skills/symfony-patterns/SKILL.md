---
name: symfony-patterns
description: "Código de referencia seguro para un módulo de una API REST en Symfony 7 + Doctrine: entidad con atributos ORM, repositorio acotado al dueño, DTO readonly, handler, Voter, Request con constraints y #[MapRequestPayload], controlador invocable con #[Route], Resource de salida y tests WebTestCase. Úsala SIEMPRE antes de escribir entidades, repositorios, handlers, DTOs, voters, controladores, requests, resources o tests de un módulo Symfony."
---

# symfony-patterns

Ejemplo con el módulo `Products`. Todos los archivos empiezan con `<?php` + `declare(strict_types=1);` (omitido abajo por brevedad). La entidad `User` vive en el módulo `Auth` (ver `references/auth.md`); búscala con Grep antes de asumirla.

No hay registro manual: `config/services.yaml` registra `src/` con autowiring, `config/routes.yaml` carga los `#[Route]` de `src/Modules/` y Doctrine mapea las entidades de `src/Modules/`. Las rutas bajo `/api` ya exigen autenticación.

## Domain — data-writer

```php
// Domain/Entity/Product.php — sin `final`: Doctrine genera proxies que extienden la clase
namespace App\Modules\Products\Domain\Entity;

use App\Modules\Auth\Domain\Entity\User;
use App\Modules\Products\Domain\Repository\ProductRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity(repositoryClass: ProductRepository::class)]
#[ORM\Table(name: 'products')]
class Product
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME, unique: true)]
    private Uuid $id;

    #[ORM\Column(length: 120)]
    private string $name;

    #[ORM\Column(type: Types::INTEGER)]
    private int $priceCents;                       // dinero en enteros, nunca float

    // owner sin setter: lo asigna el servidor desde el usuario autenticado
    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $owner;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $createdAt;

    public function __construct(string $name, int $priceCents, User $owner)
    {
        $this->id = Uuid::v7();
        $this->name = $name;
        $this->priceCents = $priceCents;
        $this->owner = $owner;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function rename(string $name): void { $this->name = $name; }
    public function getId(): Uuid { return $this->id; }
    public function getName(): string { return $this->name; }
    public function getPriceCents(): int { return $this->priceCents; }
    public function getOwner(): User { return $this->owner; }
    public function isOwnedBy(User $user): bool { return $this->owner->getId()->equals($user->getId()); }
}
```

```php
// Domain/Repository/ProductRepository.php
namespace App\Modules\Products\Domain\Repository;

use App\Modules\Auth\Domain\Entity\User;
use App\Modules\Products\Domain\Entity\Product;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/** @extends ServiceEntityRepository<Product> */
final class ProductRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Product::class);
    }

    /** Recurso ajeno o inexistente → null (el controlador responde 404, nunca 403). */
    public function findOneOwnedBy(string $id, User $owner): ?Product
    {
        if (!Uuid::isValid($id)) {
            return null;
        }

        return $this->findOneBy(['id' => Uuid::fromString($id), 'owner' => $owner]);
    }
}
```

Migraciones: no las escribe el data-writer. El orquestador corre `make migration NAME=create_products` (Doctrine diff), revisa `migrations/Version*.php` y `make migrate`.

## Application — app-writer

```php
// Application/DTO/CreateProductData.php
namespace App\Modules\Products\Application\DTO;

final readonly class CreateProductData
{
    public function __construct(public string $name, public int $priceCents) {}
}
```

```php
// Application/Handler/CreateProduct.php
namespace App\Modules\Products\Application\Handler;

use App\Modules\Auth\Domain\Entity\User;
use App\Modules\Products\Application\DTO\CreateProductData;
use App\Modules\Products\Domain\Entity\Product;
use Doctrine\ORM\EntityManagerInterface;

final class CreateProduct
{
    public function __construct(private readonly EntityManagerInterface $em) {}

    public function handle(CreateProductData $data, User $owner): Product
    {
        // wrapInTransaction hace flush y commit; si algo lanza, rollback
        return $this->em->wrapInTransaction(function () use ($data, $owner): Product {
            $product = new Product($data->name, $data->priceCents, $owner);
            $this->em->persist($product);

            return $product;
        });
    }
}
```

```php
// Application/Security/ProductVoter.php — se registra solo (autoconfigure)
namespace App\Modules\Products\Application\Security;

use App\Modules\Auth\Domain\Entity\User;
use App\Modules\Products\Domain\Entity\Product;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/** @extends Voter<string, Product> */
final class ProductVoter extends Voter
{
    public const EDIT = 'PRODUCT_EDIT';
    public const DELETE = 'PRODUCT_DELETE';

    protected function supports(string $attribute, mixed $subject): bool
    {
        return \in_array($attribute, [self::EDIT, self::DELETE], true) && $subject instanceof Product;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token): bool
    {
        $user = $token->getUser();

        return $user instanceof User && $subject->isOwnedBy($user);   // ajusta al contrato (rol, plan…)
    }
}
```

## Http — http-writer

```php
// Http/Request/CreateProductRequest.php — solo los campos que el cliente puede enviar; owner_id se ignora
namespace App\Modules\Products\Http\Request;

use App\Modules\Products\Application\DTO\CreateProductData;
use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

final readonly class CreateProductRequest
{
    public function __construct(
        #[Assert\NotBlank, Assert\Length(max: 120)]
        public string $name = '',
        #[SerializedName('price_cents'), Assert\Positive, Assert\LessThanOrEqual(100_000_000)]
        public int $priceCents = 0,
    ) {}

    public function toData(): CreateProductData
    {
        return new CreateProductData(trim($this->name), $this->priceCents);
    }
}
```

```php
// Http/Resource/ProductResource.php — campos explícitos, nunca la entidad serializada entera
namespace App\Modules\Products\Http\Resource;

use App\Modules\Products\Domain\Entity\Product;

final class ProductResource
{
    /** @return array{id: string, name: string, price_cents: int} */
    public static function from(Product $product): array
    {
        return ['id' => $product->getId()->toRfc4122(), 'name' => $product->getName(), 'price_cents' => $product->getPriceCents()];
    }
}
```

```php
// Http/Controller/CreateProductController.php — entrada inválida → 422 automático (#[MapRequestPayload])
namespace App\Modules\Products\Http\Controller;

use App\Modules\Auth\Domain\Entity\User;
use App\Modules\Products\Application\Handler\CreateProduct;
use App\Modules\Products\Http\Request\CreateProductRequest;
use App\Modules\Products\Http\Resource\ProductResource;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[AsController]
#[Route('/api/products', name: 'products_create', methods: ['POST'])]
final class CreateProductController
{
    public function __construct(private readonly CreateProduct $createProduct) {}

    public function __invoke(#[MapRequestPayload] CreateProductRequest $request, #[CurrentUser] User $user): JsonResponse
    {
        $product = $this->createProduct->handle($request->toData(), $user);

        return new JsonResponse(ProductResource::from($product), Response::HTTP_CREATED);
    }
}
```

```php
// Http/Controller/ShowProductController.php — recurso ajeno → 404, no 403
#[AsController]
#[Route('/api/products/{id}', name: 'products_show', methods: ['GET'], requirements: ['id' => Requirement::UUID])]
final class ShowProductController
{
    public function __construct(private readonly ProductRepository $products) {}

    public function __invoke(string $id, #[CurrentUser] User $user): JsonResponse
    {
        $product = $this->products->findOneOwnedBy($id, $user) ?? throw new NotFoundHttpException();

        return new JsonResponse(ProductResource::from($product));
    }
}
```

```php
// Http/Controller/DeleteProductController.php — permiso fino con el Voter (use: Security, AccessDeniedException)
public function __invoke(string $id, #[CurrentUser] User $user, Security $security): Response
{
    $product = $this->products->findOneOwnedBy($id, $user) ?? throw new NotFoundHttpException();
    if (!$security->isGranted(ProductVoter::DELETE, $product)) {
        throw new AccessDeniedException();
    }
    $this->deleteProduct->handle($product);

    return new Response(null, Response::HTTP_NO_CONTENT);
}
```

Límite de peticiones en endpoints sensibles: un limiter en `config/packages/rate_limiter.yaml` (orquestador) e inyecta `RateLimiterFactory $productsCreateLimiter`; si `->consume()->isAccepted()` es falso, `TooManyRequestsHttpException`.

## Tests — qa-writer (`tests/Modules/Products/CreateProductTest.php`)

El firewall es *stateless*: autentica con un access token real (`Authorization: Bearer …`), no con `loginUser()`. La BD de test es la del overlay con sufijo `_test` (`when@test` en `doctrine.yaml`); el orquestador la crea una vez (ver `docs/stacks/symfony.md`).

```php
namespace App\Tests\Modules\Products;

use App\Modules\Auth\Application\Handler\IssueAccessToken;
use App\Modules\Auth\Domain\Entity\User;
use App\Modules\Products\Domain\Entity\Product;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class CreateProductTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();                        // misma conexión en todo el test
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        $this->em->getConnection()->beginTransaction();       // cada test deshace sus datos
    }

    protected function tearDown(): void
    {
        $this->em->getConnection()->rollBack();
        parent::tearDown();
    }

    private function bearer(User $user): array
    {
        $plain = static::getContainer()->get(IssueAccessToken::class)->handle($user, 'tests');

        return ['HTTP_AUTHORIZATION' => 'Bearer '.$plain];
    }

    private function user(string $email): User
    {
        $user = new User($email, 'hash-no-usado');
        $this->em->persist($user);
        $this->em->flush();

        return $user;
    }

    public function testRequiresAuthentication(): void
    {
        $this->client->jsonRequest('POST', '/api/products', ['name' => 'A', 'price_cents' => 100]);
        self::assertResponseStatusCodeSame(401);
    }

    public function testValidatesInput(): void
    {
        $this->client->jsonRequest('POST', '/api/products', ['name' => ''], $this->bearer($this->user('a@x.test')));
        self::assertResponseStatusCodeSame(422);
    }

    public function testIgnoresOwnerSentByClient(): void
    {
        $user = $this->user('a@x.test');
        $other = $this->user('b@x.test');
        $this->client->jsonRequest('POST', '/api/products',
            ['name' => 'A', 'price_cents' => 100, 'owner_id' => $other->getId()->toRfc4122()], $this->bearer($user));

        self::assertResponseStatusCodeSame(201);
        $product = $this->em->getRepository(Product::class)->findOneBy(['name' => 'A']);
        self::assertTrue($product?->isOwnedBy($user));
    }

    public function testHidesProductsOfOtherUsers(): void
    {
        $product = new Product('A', 100, $this->user('b@x.test'));
        $this->em->persist($product);
        $this->em->flush();

        $this->client->jsonRequest('GET', '/api/products/'.$product->getId()->toRfc4122(), [], $this->bearer($this->user('a@x.test')));
        self::assertResponseStatusCodeSame(404);
    }
}
```

## Equivalencias con Laravel (stack `laravel`)

| Pieza | Symfony | Laravel |
|---|---|---|
| Domain | Entidad Doctrine sin setters para campos del servidor | Modelo Eloquent + `$fillable` |
| Migraciones | `make migration` (Doctrine diff), orquestador | Migración anónima del módulo |
| Application | Handler + DTO readonly | Action + DTO readonly |
| Autorización | Voter | Policy |
| Validación | Request con constraints + `#[MapRequestPayload]` | FormRequest |
| Salida | Resource (`array` explícito) | API Resource |
