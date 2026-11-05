---
name: php-patterns
description: Código de referencia seguro para un módulo PHP modular en Laravel - modelo Eloquent con $fillable, migración, DTO readonly, Action, Policy, FormRequest con authorize y toData, controlador invocable, API Resource, rutas y tests Pest. Incluye equivalencias para Symfony. Úsala SIEMPRE antes de escribir modelos, migraciones, actions, DTOs, policies, controladores, requests, resources o tests de un módulo PHP.
---

# php-patterns

Ejemplo con el módulo `Products`. Todos los archivos empiezan con `<?php` + `declare(strict_types=1);` (omitido abajo por brevedad). Busca con Grep el modelo `User` y el guard reales antes de asumirlos.

## Domain/Models/Product.php — data-writer

```php
namespace App\Modules\Products\Domain\Models;

use App\Models\User;
use App\Modules\Products\Database\Factories\ProductFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Product extends Model
{
    /** @use HasFactory<ProductFactory> */
    use HasFactory, HasUuids;

    // owner_id NO va aquí: lo asigna el servidor (mass assignment)
    protected $fillable = ['name', 'price_cents'];

    protected function casts(): array
    {
        return ['price_cents' => 'integer'];
    }

    /** @return BelongsTo<User, $this> */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    protected static function newFactory(): ProductFactory
    {
        return ProductFactory::new();
    }
}
```

## Database/Migrations/2026_01_01_000000_create_products_table.php — data-writer

```php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name', 120);
            $table->unsignedBigInteger('price_cents');           // dinero en enteros, nunca float
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
```

## Application — app-writer

```php
// Application/DTOs/CreateProductData.php
namespace App\Modules\Products\Application\DTOs;

final readonly class CreateProductData
{
    public function __construct(public string $name, public int $priceCents) {}
}
```

```php
// Application/Actions/CreateProduct.php
namespace App\Modules\Products\Application\Actions;

use App\Models\User;
use App\Modules\Products\Application\DTOs\CreateProductData;
use App\Modules\Products\Domain\Models\Product;
use Illuminate\Support\Facades\DB;

final class CreateProduct
{
    public function handle(CreateProductData $data, User $owner): Product
    {
        return DB::transaction(function () use ($data, $owner): Product {
            $product = new Product(['name' => $data->name, 'price_cents' => $data->priceCents]);
            $product->owner()->associate($owner);   // dueño desde el usuario autenticado
            $product->save();

            return $product;
        });
    }
}
```

```php
// Application/Policies/ProductPolicy.php — registro: Gate::policy() en el provider (orquestador)
namespace App\Modules\Products\Application\Policies;

use App\Models\User;
use App\Modules\Products\Domain\Models\Product;

final class ProductPolicy
{
    public function create(User $user): bool { return true; }   // ajusta al contrato (rol, plan…)
    public function view(User $user, Product $product): bool { return $product->owner_id === $user->id; }
    public function update(User $user, Product $product): bool { return $product->owner_id === $user->id; }
}
```

## Http — http-writer

```php
// Http/Requests/StoreProductRequest.php
namespace App\Modules\Products\Http\Requests;

use App\Modules\Products\Application\DTOs\CreateProductData;
use App\Modules\Products\Domain\Models\Product;
use Illuminate\Foundation\Http\FormRequest;

final class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', Product::class) ?? false;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'price_cents' => ['required', 'integer', 'min:1', 'max:100000000'],
        ];
    }

    public function toData(): CreateProductData
    {
        return new CreateProductData(trim($this->string('name')->toString()), $this->integer('price_cents'));
    }
}
```

```php
// Http/Controllers/StoreProductController.php
namespace App\Modules\Products\Http\Controllers;

use App\Modules\Products\Application\Actions\CreateProduct;
use App\Modules\Products\Http\Requests\StoreProductRequest;
use App\Modules\Products\Http\Resources\ProductResource;
use Illuminate\Http\JsonResponse;

final class StoreProductController
{
    public function __invoke(StoreProductRequest $request, CreateProduct $action): JsonResponse
    {
        $product = $action->handle($request->toData(), $request->user());

        return ProductResource::make($product)->response()->setStatusCode(201);
    }
}
```

```php
// Http/Controllers/ShowProductController.php — recurso ajeno → 404, no 403
// use: Product, ProductResource, Illuminate\Http\Request
final class ShowProductController
{
    public function __invoke(Request $request, string $id): ProductResource
    {
        $product = Product::query()->whereBelongsTo($request->user(), 'owner')->findOrFail($id);

        return ProductResource::make($product);
    }
}
```

```php
// Http/Resources/ProductResource.php — campos explícitos, nunca parent::toArray()
// use: Illuminate\Http\Request, Illuminate\Http\Resources\Json\JsonResource
/** @mixin \App\Modules\Products\Domain\Models\Product */
final class ProductResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return ['id' => $this->id, 'name' => $this->name, 'price_cents' => $this->price_cents];
    }
}
```

```php
// Http/routes.php (dentro del grupo generado por el scaffold)
Route::post('/', StoreProductController::class)->middleware('throttle:30,1');
Route::get('/{id}', ShowProductController::class)->whereUuid('id');
```

## Tests — qa-writer (`tests/Modules/Products/StoreProductTest.php`)

```php
use App\Models\User;
use App\Modules\Products\Domain\Models\Product;
use function Pest\Laravel\{actingAs, getJson, postJson, assertDatabaseHas};

it('requiere autenticación', function () {
    postJson('/api/products', ['name' => 'A', 'price_cents' => 100])->assertUnauthorized();
});

it('valida el input', function () {
    actingAs(User::factory()->create());
    postJson('/api/products', ['name' => ''])->assertUnprocessable()->assertJsonValidationErrors(['name', 'price_cents']);
});

it('ignora owner_id enviado por el cliente', function () {
    $user = User::factory()->create();
    $other = User::factory()->create();
    actingAs($user);
    postJson('/api/products', ['name' => 'A', 'price_cents' => 100, 'owner_id' => $other->id])->assertCreated();
    assertDatabaseHas('products', ['name' => 'A', 'owner_id' => $user->id]);
});

it('no muestra productos ajenos', function () {
    $product = Product::factory()->create();
    actingAs(User::factory()->create());
    getJson("/api/products/{$product->id}")->assertNotFound();
});
```

## Equivalencias en Symfony

| Pieza | Laravel | Symfony |
|---|---|---|
| Domain | Modelo Eloquent + `$fillable` | Entidad Doctrine con atributos `#[ORM\...]`, sin setters para campos del servidor |
| Database | Migración anónima | `doctrine:migrations:diff` (orquestador) |
| Application | Action + DTO readonly | Servicio/handler + DTO readonly |
| Autorización | Policy | Voter (`#[IsGranted('PRODUCT_VIEW', 'product')]`) |
| Validación | FormRequest | DTO con constraints + `#[MapRequestPayload]` |
| Salida | API Resource | Normalizer o grupos de serialización explícitos |
| Registro | ServiceProvider | `config/services.yaml` (`App\Modules\:` resource) + rutas por atributos |
