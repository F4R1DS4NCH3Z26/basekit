---
name: phpnative-patterns
description: "Código de referencia seguro para un módulo de una API REST en PHP nativo (sin framework) con PDO: migración SQL portable, entidad con fromRow, repositorio PDO acotado al dueño, DTO readonly, handler, Policy, Input con validación, controlador invocable, routes.php, Resource de salida y tests con AppTestCase. Úsala SIEMPRE antes de escribir migraciones, entidades, repositorios, handlers, DTOs, políticas, controladores, inputs, resources o tests de un módulo PHP nativo."
---

# phpnative-patterns

Ejemplo con el módulo `Products`. Todos los archivos PHP empiezan con `<?php` + `declare(strict_types=1);` (omitido abajo por brevedad). La tabla `users` y el autenticador viven en el módulo `Auth` (ver `references/auth.md`); búscalos con Grep antes de asumirlos.

Piezas de `src/Core/` (orquestador; no se editan desde un módulo): `Kernel` (rutas, auth, errores JSON), `Http\{Router, Request, Response, Input, HttpException}`, `Container` (autowiring por tipo), `Database\{Database, Migrator}`, `Security\{Identity, Authenticator}` y `Uuid`.

No hay registro manual: el Kernel carga `src/Modules/*/Http/routes.php`, el Container construye repositorios, handlers y controladores por el tipo de sus argumentos (PDO viene de `App\Core\Services`) y el migrador lee `src/Modules/*/Migrations/*.sql`. Toda ruta exige autenticación salvo `public: true`.

## Migrations + Domain — data-writer

```sql
-- Migrations/20260115093000_create_products.sql — SQL portable (PostgreSQL, MySQL y SQLite)
CREATE TABLE products (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner_id CHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    price_cents BIGINT NOT NULL,          -- dinero en enteros, nunca FLOAT
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL         -- UTC, 'Y-m-d H:i:s'
);
CREATE INDEX products_owner_id ON products (owner_id);
```

- Nombre: `<YYYYMMDDHHMMSS>_<snake_case>.sql` (`make module-migration M=Products NAME=create_products` lo crea). Una versión se aplica una sola vez: nunca edites una migración aplicada.
- Si un motor necesita otra sintaxis (por ejemplo `JSONB`, `AUTO_INCREMENT` o un trigger), crea además `20260115093000_create_products.pgsql.sql` (o `.mysql.sql`, `.sqlite.sql`): esa variante reemplaza al archivo portable en ese motor. Los tests corren sobre SQLite.
- Cuerpos `$$ … $$` de PostgreSQL y `;` dentro de comillas están bien. Escapa comillas duplicándolas (`'it''s'`), no con `\`.

```php
// Domain/Enum/ProductStatus.php
namespace App\Modules\Products\Domain\Enum;

enum ProductStatus: string
{
    case Draft = 'draft';
    case Published = 'published';
}
```

```php
// Domain/Entity/Product.php
namespace App\Modules\Products\Domain\Entity;

use App\Core\Uuid;
use App\Modules\Products\Domain\Enum\ProductStatus;

final class Product
{
    private function __construct(
        public readonly string $id,
        public readonly string $ownerId,          // sin setter: lo asigna el servidor
        private string $name,
        private int $priceCents,
        private ProductStatus $status,
        public readonly \DateTimeImmutable $createdAt,
    ) {}

    public static function create(string $ownerId, string $name, int $priceCents): self
    {
        return new self(Uuid::v7(), $ownerId, $name, $priceCents, ProductStatus::Draft, new \DateTimeImmutable('now', new \DateTimeZone('UTC')));
    }

    /** @param array<string, mixed> $row */
    public static function fromRow(array $row): self
    {
        return new self(
            (string) $row['id'],
            (string) $row['owner_id'],
            (string) $row['name'],
            (int) $row['price_cents'],
            ProductStatus::from((string) $row['status']),
            new \DateTimeImmutable((string) $row['created_at'], new \DateTimeZone('UTC')),
        );
    }

    public function rename(string $name): void
    {
        $this->name = $name;
    }

    public function publish(): void
    {
        $this->status = ProductStatus::Published;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function priceCents(): int
    {
        return $this->priceCents;
    }

    public function status(): ProductStatus
    {
        return $this->status;
    }
}
```

```php
// Domain/Repository/ProductRepository.php
namespace App\Modules\Products\Domain\Repository;

use App\Modules\Products\Domain\Entity\Product;

final class ProductRepository
{
    public function __construct(private readonly \PDO $pdo) {}

    /** Acotado al dueño: un producto ajeno no existe para quien pregunta. */
    public function findOwnedBy(string $id, string $ownerId): ?Product
    {
        $stmt = $this->pdo->prepare('SELECT * FROM products WHERE id = ? AND owner_id = ?');
        $stmt->execute([$id, $ownerId]);
        $row = $stmt->fetch();

        return is_array($row) ? Product::fromRow($row) : null;
    }

    /** @return list<Product> */
    public function listOwnedBy(string $ownerId, int $limit = 50, int $offset = 0): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM products WHERE owner_id = ? ORDER BY id LIMIT ? OFFSET ?');
        $stmt->bindValue(1, $ownerId);
        $stmt->bindValue(2, $limit, \PDO::PARAM_INT);
        $stmt->bindValue(3, $offset, \PDO::PARAM_INT);
        $stmt->execute();

        return array_map(Product::fromRow(...), $stmt->fetchAll());
    }

    public function insert(Product $product): void
    {
        $this->pdo->prepare('INSERT INTO products (id, owner_id, name, price_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$product->id, $product->ownerId, $product->name(), $product->priceCents(), $product->status()->value, $product->createdAt->format('Y-m-d H:i:s')]);
    }

    public function update(Product $product): void
    {
        $this->pdo->prepare('UPDATE products SET name = ?, price_cents = ?, status = ? WHERE id = ?')
            ->execute([$product->name(), $product->priceCents(), $product->status()->value, $product->id]);
    }

    public function delete(Product $product): void
    {
        $this->pdo->prepare('DELETE FROM products WHERE id = ?')->execute([$product->id]);
    }
}
```

- Nunca concatenes entrada en SQL. Para un `ORDER BY` elegido por el cliente, mapea contra una lista cerrada (`['name' => 'name', 'newest' => 'created_at DESC']`).
- Ids UUID v7 ordenados por tiempo: `ORDER BY id` equivale a orden de creación.

## Application — app-writer

```php
// Application/DTO/CreateProductData.php
namespace App\Modules\Products\Application\DTO;

final readonly class CreateProductData
{
    public function __construct(
        public string $name,
        public int $priceCents,
    ) {}
}
```

```php
// Application/Handler/CreateProduct.php
namespace App\Modules\Products\Application\Handler;

use App\Core\Security\Identity;
use App\Modules\Products\Application\DTO\CreateProductData;
use App\Modules\Products\Domain\Entity\Product;
use App\Modules\Products\Domain\Repository\ProductRepository;

final class CreateProduct
{
    public function __construct(private readonly ProductRepository $products) {}

    public function handle(CreateProductData $data, Identity $owner): Product
    {
        $product = Product::create($owner->userId, $data->name, $data->priceCents);
        $this->products->insert($product);

        return $product;
    }
}
```

Varias escrituras van en una transacción:

```php
use App\Core\Database\Database;

public function __construct(private readonly \PDO $pdo, private readonly ProductRepository $products, private readonly StockRepository $stock) {}

public function handle(...): Product
{
    return Database::transaction($this->pdo, function () use ($data, $owner): Product {
        $product = Product::create($owner->userId, $data->name, $data->priceCents);
        $this->products->insert($product);
        $this->stock->open($product->id, $data->initialStock);

        return $product;
    });
}
```

```php
// Application/Security/ProductPolicy.php
namespace App\Modules\Products\Application\Security;

use App\Core\Security\Identity;
use App\Modules\Products\Domain\Entity\Product;

final class ProductPolicy
{
    public function canEdit(Identity $identity, Product $product): bool
    {
        return $identity->role === 'admin' || $product->ownerId === $identity->userId;
    }
}
```

## Http — http-writer

```php
// Http/routes.php
use App\Core\Http\Router;
use App\Modules\Products\Http\Controller\CreateProductController;
use App\Modules\Products\Http\Controller\ShowProductController;

return static function (Router $r): void {
    $r->post('/api/products', CreateProductController::class);
    $r->get('/api/products/{id}', ShowProductController::class);
};
```

```php
// Http/Input/CreateProductInput.php — solo los campos que el cliente puede enviar
namespace App\Modules\Products\Http\Input;

use App\Core\Http\Input;
use App\Core\Http\Request;
use App\Modules\Products\Application\DTO\CreateProductData;

final class CreateProductInput
{
    public static function from(Request $request): CreateProductData
    {
        $in = Input::from($request);
        $name = $in->string('name', max: 120);
        $priceCents = $in->int('price_cents', min: 1, max: 100_000_000);
        $in->validate();                              // 422 con todos los errores

        return new CreateProductData((string) $name, (int) $priceCents);
    }
}
```

```php
// Http/Resource/ProductResource.php — campos explícitos, nunca la fila completa
namespace App\Modules\Products\Http\Resource;

use App\Modules\Products\Domain\Entity\Product;

final class ProductResource
{
    /** @return array<string, mixed> */
    public static function from(Product $product): array
    {
        return [
            'id' => $product->id,
            'name' => $product->name(),
            'price_cents' => $product->priceCents(),
            'status' => $product->status()->value,
            'created_at' => $product->createdAt->format(\DATE_ATOM),
        ];
    }
}
```

```php
// Http/Controller/CreateProductController.php
namespace App\Modules\Products\Http\Controller;

use App\Core\Http\Request;
use App\Core\Http\Response;
use App\Modules\Products\Application\Handler\CreateProduct;
use App\Modules\Products\Http\Input\CreateProductInput;
use App\Modules\Products\Http\Resource\ProductResource;

final class CreateProductController
{
    public function __construct(private readonly CreateProduct $createProduct) {}

    public function __invoke(Request $request): Response
    {
        $product = $this->createProduct->handle(CreateProductInput::from($request), $request->identity());

        return Response::json(ProductResource::from($product), 201);
    }
}
```

```php
// Http/Controller/ShowProductController.php
namespace App\Modules\Products\Http\Controller;

use App\Core\Http\HttpException;
use App\Core\Http\Request;
use App\Core\Http\Response;
use App\Core\Uuid;
use App\Modules\Products\Domain\Repository\ProductRepository;
use App\Modules\Products\Http\Resource\ProductResource;

final class ShowProductController
{
    public function __construct(private readonly ProductRepository $products) {}

    public function __invoke(Request $request): Response
    {
        $id = $request->param('id');
        $product = Uuid::isValid($id) ? $this->products->findOwnedBy($id, $request->identity()->userId) : null;
        if ($product === null) {
            throw HttpException::notFound();                 // ajeno o inexistente: siempre 404
        }

        return Response::json(ProductResource::from($product));
    }
}
```

- Respuestas: `Response::json($data, 201)`, `Response::noContent()` (204). Errores: `HttpException::notFound()`, `HttpException::forbidden()`, `new HttpException(409, 'Conflict')`. El Kernel los convierte en `{"error": "..."}` (y `errors` por campo en 422); cualquier otra excepción es 500 sin detalles salvo con `APP_DEBUG=1`.
- Paginación: `$request->query['page']` llega como string; valídalo con `filter_var($v, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])`.

## Tests — qa-writer (`tests/Modules/Products/CreateProductTest.php`)

```php
namespace App\Tests\Modules\Products;

use App\Core\Security\Identity;
use App\Core\Uuid;
use App\Tests\Support\AppTestCase;

final class CreateProductTest extends AppTestCase
{
    private function user(): Identity
    {
        $id = Uuid::v7();
        $this->pdo->prepare("INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, 'x', 'member', '2026-01-01 00:00:00')")
            ->execute([$id, $id . '@example.com']);

        return new Identity($id);
    }

    public function testRequiresAuthentication(): void
    {
        self::assertSame(401, $this->request('POST', '/api/products', ['name' => 'Mesa', 'price_cents' => 1000])->status);
    }

    public function testValidatesInput(): void
    {
        $this->actingAs($this->user());

        $response = $this->request('POST', '/api/products', ['name' => '', 'price_cents' => 'mil']);

        self::assertSame(422, $response->status);
        self::assertArrayHasKey('name', $response->decoded()['errors']);
        self::assertArrayHasKey('price_cents', $response->decoded()['errors']);
    }

    public function testCreatesForTheCallerAndIgnoresProtectedFields(): void
    {
        $owner = $this->user();
        $this->actingAs($owner);

        $response = $this->request('POST', '/api/products', ['name' => 'Mesa', 'price_cents' => 1000, 'owner_id' => 'otro', 'status' => 'published']);

        self::assertSame(201, $response->status);
        $row = $this->pdo->query('SELECT owner_id, status FROM products')->fetch();
        self::assertSame(['owner_id' => $owner->userId, 'status' => 'draft'], $row);
    }

    public function testAnotherUsersProductIs404(): void
    {
        $this->actingAs($this->user());
        $created = $this->request('POST', '/api/products', ['name' => 'Mesa', 'price_cents' => 1000])->decoded();

        $this->actingAs($this->user());
        self::assertSame(404, $this->request('GET', '/api/products/' . $created['id'])->status);
    }
}
```

- `AppTestCase` arma el Kernel real sobre SQLite en memoria con todas las migraciones, una base vacía por test. Sin servidor ni red.
- Un servicio externo se reemplaza antes del request: `$this->container->instance(PaymentGateway::class, new FakePaymentGateway())`.
- Unitarios de handler: construye el handler con un repositorio sobre `$this->pdo` (`new CreateProduct(new ProductRepository($this->pdo))`).
