---
name: java-patterns
description: Código de referencia seguro para un bounded context Spring Boot con DDD - entidad JPA con fábrica, interfaz de repositorio en domain con implementación Spring Data, migración Flyway, DTOs record con Bean Validation, servicio transaccional con verificación de propiedad, controlador REST delgado, manejo de errores con ProblemDetail, tests (Mockito, WebMvcTest) y ArchitectureTest con ArchUnit. Úsala SIEMPRE antes de escribir entidades, repositorios, migraciones, servicios, DTOs, controladores o tests Java.
---

# java-patterns

Ejemplo: dominio `products`, paquete base `com.app`. Copia la forma y cambia los nombres. Busca en `core/` con Grep el tipo del usuario autenticado (`CurrentUser` abajo) antes de asumirlo.

## domain — domain-writer

```java
// domain/Product.java — JPA en domain es una concesión pragmática; Spring Web no.
@Entity
@Table(name = "products")
public class Product {
    @Id private UUID id;
    @Column(nullable = false, length = 120) private String name;
    @Column(name = "price_cents", nullable = false) private long priceCents;
    @Column(name = "owner_id", nullable = false, updatable = false) private UUID ownerId;

    protected Product() {} // requerido por JPA

    public static Product create(String name, long priceCents, UUID ownerId) {
        if (priceCents <= 0) throw new IllegalArgumentException("price must be positive");
        var p = new Product();
        p.id = UUID.randomUUID();
        p.name = name;
        p.priceCents = priceCents;
        p.ownerId = ownerId;
        return p;
    }

    public void rename(String newName) { this.name = newName; } // mutaciones con intención, no setters

    public boolean isOwnedBy(UUID userId) { return ownerId.equals(userId); }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public long getPriceCents() { return priceCents; }

    @Override public boolean equals(Object o) { return o instanceof Product p && id.equals(p.id); }
    @Override public int hashCode() { return id.hashCode(); }
}
```

```java
// domain/ProductRepository.java — contrato del dominio, sin Spring Data
public interface ProductRepository {
    Product save(Product product);
    Optional<Product> findByIdAndOwnerId(UUID id, UUID ownerId);
    List<Product> findTop100ByOwnerIdOrderByNameAsc(UUID ownerId);
}

// domain/ProductNotFoundException.java
public class ProductNotFoundException extends RuntimeException {
    public ProductNotFoundException(UUID id) { super("Product not found: " + id); }
}
```

```java
// infrastructure/JpaProductRepository.java — Spring Data implementa la interfaz del dominio
interface JpaProductRepository extends JpaRepository<Product, UUID>, ProductRepository {}
```

```sql
-- src/main/resources/db/migration/V4__create_products.sql (versión fijada en el contrato)
CREATE TABLE products (
    id          UUID PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    price_cents BIGINT       NOT NULL CHECK (price_cents > 0),
    owner_id    UUID         NOT NULL
);
CREATE INDEX idx_products_owner ON products (owner_id);
```

## application — app-writer

```java
// application/dto/CreateProductRequest.java
public record CreateProductRequest(
        @NotBlank @Size(max = 120) String name,
        @Positive @Max(100_000_000) long priceCents) {}

// application/dto/ProductResponse.java — solo campos del contrato
public record ProductResponse(UUID id, String name, long priceCents) {
    static ProductResponse from(Product p) { return new ProductResponse(p.getId(), p.getName(), p.getPriceCents()); }
}
```

```java
// application/ProductService.java
@Service
@Transactional(readOnly = true)
public class ProductService {
    private final ProductRepository products;

    public ProductService(ProductRepository products) { this.products = products; }

    @Transactional
    public ProductResponse create(CreateProductRequest req, UUID ownerId) {
        var product = Product.create(req.name().strip(), req.priceCents(), ownerId);
        return ProductResponse.from(products.save(product));
    }

    public ProductResponse get(UUID id, UUID userId) {
        return products.findByIdAndOwnerId(id, userId)   // ajeno == inexistente → 404
                .map(ProductResponse::from)
                .orElseThrow(() -> new ProductNotFoundException(id));
    }
}
```

## presentation — web-writer

```java
// presentation/ProductController.java
@RestController
@RequestMapping("/api/products")
class ProductController {
    private final ProductService service;

    ProductController(ProductService service) { this.service = service; }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    ProductResponse create(@Valid @RequestBody CreateProductRequest req,
                           @AuthenticationPrincipal CurrentUser user) {
        return service.create(req, user.id()); // dueño desde la sesión, nunca del body
    }

    @GetMapping("/{id}")
    ProductResponse get(@PathVariable UUID id, @AuthenticationPrincipal CurrentUser user) {
        return service.get(id, user.id());
    }
}
```

## core — orquestador (referencia; los subagentes no lo editan)

```java
// core/web/GlobalExceptionHandler.java — un solo lugar traduce dominio → HTTP
@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(ProductNotFoundException.class) // o una base común NotFoundException
    ProblemDetail notFound(RuntimeException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "Recurso no encontrado"); // sin detalles internos
    }
}
```

```java
// src/test/java/com/app/ArchitectureTest.java — hace cumplir las capas en cada verify
@AnalyzeClasses(packages = "com.app", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {
    @ArchTest static final ArchRule domainIsIsolated = noClasses()
            .that().resideInAPackage("..modules..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage("..application..", "..presentation..", "org.springframework.web..");

    @ArchTest static final ArchRule webDoesNotTouchInfrastructure = noClasses()
            .that().resideInAPackage("..presentation..")
            .should().dependOnClassesThat().resideInAPackage("..infrastructure..");

    @ArchTest static final ArchRule entitiesNeverLeaveThroughWeb = noClasses()
            .that().resideInAPackage("..presentation..")
            .should().dependOnClassesThat().areAnnotatedWith(jakarta.persistence.Entity.class);
}
```

Alternativa: Spring Modulith (`ApplicationModules.of(App.class).verify()`) también valida dependencias entre módulos.

## Tests — qa-writer

```java
// Unitario del servicio, sin contexto Spring
class ProductServiceTest {
    ProductRepository repo = mock(ProductRepository.class);
    ProductService service = new ProductService(repo);

    @Test void getOfOtherUsersProductThrowsNotFound() {
        when(repo.findByIdAndOwnerId(any(), any())).thenReturn(Optional.empty());
        assertThrows(ProductNotFoundException.class, () -> service.get(UUID.randomUUID(), UUID.randomUUID()));
    }
}
```

```java
// Slice web: rápido, solo MVC + validación + seguridad
@WebMvcTest(ProductController.class)
class ProductControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean ProductService service; // Spring Boot 3.4+ (antes: @MockBean)

    @Test void createRequiresAuth() throws Exception {
        mvc.perform(post("/api/products").contentType(APPLICATION_JSON).content("{}"))
           .andExpect(status().isUnauthorized());
    }

    @Test void createValidatesInput() throws Exception {
        mvc.perform(post("/api/products").with(user("u1")).with(csrf())
                .contentType(APPLICATION_JSON).content("{\"name\":\"\",\"priceCents\":-1}"))
           .andExpect(status().isBadRequest());
    }
}
```

El tipo del principal en los tests (`user(...)`, `jwt()`) depende de `core/security`; usa el helper que defina el orquestador.
