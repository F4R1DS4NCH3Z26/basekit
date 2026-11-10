---
name: vanilla-patterns
description: "Código de referencia seguro para una feature de la SPA TypeScript + Vite sin framework - schema Zod, llamada a la API con apiFetch, store con createStore, componente como función que devuelve un elemento, formulario, página con cancelación y tests con Vitest y Testing Library (DOM). Úsala SIEMPRE antes de escribir schemas, api, stores, componentes, páginas o tests de una feature, para copiar el patrón del proyecto en vez de inventar uno."
---

# vanilla-patterns

Copia la forma, cambia los nombres. Ejemplo con la feature `products`. Lo crea `make new-app` (zona del orquestador):
- `src/lib/api.ts`: `apiFetch(path, parse, init)` y `ApiError`.
- `src/lib/dom.ts`: `h(tag, attrs, ...children)` y `mount(parent, ...children)`. El texto siempre va como nodo de texto.
- `src/lib/router.ts`: `startRouter`, `navigate` y los tipos `Page` y `RouteContext` (`params`, `query`, `signal`).
- `src/lib/store.ts`: `createStore(initial)` con `get`, `set` y `subscribe`.

Sesión y login: `references/auth.md`.

Convenciones: archivos en kebab-case (`product-form.ts`); un componente es una función `camelCase` que recibe un objeto de opciones y devuelve un `HTMLElement`; una página es una función `xxxPage(ctx: RouteContext)`. Sin clases de componente, sin Web Components, sin frameworks.

## schemas.ts — logic-writer

```ts
import { z } from "zod";

export const productSchema = z.object({ id: z.string(), name: z.string(), price: z.number() });
export const productListSchema = z.array(productSchema);
export type Product = z.infer<typeof productSchema>;

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.coerce.number().positive().max(1_000_000),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
```

## api.ts — logic-writer

```ts
import { apiFetch } from "../../lib/api";
import { productListSchema, productSchema, type CreateProductInput } from "./schemas";

// `schema.parse` es el parser: apiFetch convierte un fallo de forma en ApiError.
export function listProducts(signal?: AbortSignal) {
  return apiFetch("/products", productListSchema.parse, { signal });
}

export function createProduct(input: CreateProductInput) {
  return apiFetch("/products", productSchema.parse, { method: "POST", body: JSON.stringify(input) });
}
```

## stores.ts — logic-writer (solo si el contrato lo pide)

```ts
import { createStore } from "../../lib/store";

export const productFilters = createStore({ query: "" });
// Uso: productFilters.set({ query: "abc" }); const off = productFilters.subscribe((s) => …); off();
```

## components/product-form.ts — ui-writer

```ts
import { z } from "zod";
import { h, mount } from "../../../lib/dom";
import { createProduct } from "../api";
import { createProductSchema } from "../schemas";

export function productForm({ onCreated }: { onCreated: () => void }): HTMLFormElement {
  const nameError = h("p", { role: "alert", hidden: true });
  const priceError = h("p", { role: "alert", hidden: true });
  const formError = h("p", { role: "alert", hidden: true });
  const submit = h("button", { type: "submit" }, "Guardar");

  function show(el: HTMLElement, msg?: string) {
    el.hidden = !msg;
    mount(el, msg ?? ""); // texto, nunca HTML
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    const parsed = createProductSchema.safeParse(Object.fromEntries(new FormData(form)));
    const errors = parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
    show(nameError, errors.name?.[0]);
    show(priceError, errors.price?.[0]);
    show(formError);
    if (!parsed.success) return;
    submit.disabled = true;
    mount(submit, "Guardando…");
    try { await createProduct(parsed.data); form.reset(); onCreated(); }
    catch { show(formError, "No se pudo crear el producto"); } // sin detalles internos
    finally { submit.disabled = false; mount(submit, "Guardar"); }
  }

  const form = h("form", { novalidate: true, onsubmit: onSubmit },
    h("label", { for: "name" }, "Nombre"),
    h("input", { id: "name", name: "name", maxlength: 120 }),
    nameError,
    h("label", { for: "price" }, "Precio"),
    h("input", { id: "price", name: "price", type: "number", step: "0.01" }),
    priceError,
    formError,
    submit,
  );
  return form;
}
```

## components/product-list.ts — ui-writer

```ts
import { h } from "../../../lib/dom";
import type { Product } from "../schemas";

export function productList(items: Product[]): HTMLElement {
  if (items.length === 0) return h("p", {}, "No hay productos");
  return h("ul", {}, items.map((p) => h("li", {}, `${p.name} · ${p.price}`)));
}
```

## pages/products.ts e index.ts — ui-writer

```ts
// Página delgada: compone componentes y llama a api.ts; no decide reglas de negocio.
import { h, mount } from "../../../lib/dom";
import type { RouteContext } from "../../../lib/router";
import { listProducts } from "../api";
import { productForm } from "../components/product-form";
import { productList } from "../components/product-list";

export function productsPage({ signal }: RouteContext): HTMLElement {
  const list = h("div", { "aria-live": "polite" }, "Cargando…");

  async function load() {
    try { mount(list, productList(await listProducts(signal))); }
    catch { if (!signal.aborted) mount(list, h("p", { role: "alert" }, "No se pudieron cargar los productos")); }
  }

  void load(); // `signal` se aborta si el usuario sale de la página antes de que responda la API
  return h("main", {}, h("h1", {}, "Productos"), list, productForm({ onCreated: () => void load() }));
}
```

```ts
// src/features/products/index.ts — lo único que otras features (y src/routes.ts) importan
export { productsPage } from "./pages/products";
export type { Product } from "./schemas";
```

El orquestador registra la ruta en `src/routes.ts`: `"/products": productsPage` (y `"/products/:id": productPage` → `ctx.params.id`). Para navegar desde código: `navigate("/products")`; los `<a href="/…">` del mismo origen ya los maneja el router.

## Test — qa-writer (`tests/features/products/product-form.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
vi.mock("../../../src/features/products/api", () => ({ createProduct: vi.fn() }));

import { createProduct } from "../../../src/features/products/api";
import { productForm } from "../../../src/features/products/components/product-form";

function render(el: HTMLElement) {
  document.body.replaceChildren(el);
  return el;
}

describe("productForm", () => {
  it("muestra errores y no llama a la API con input inválido", async () => {
    render(productForm({ onCreated: vi.fn() }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(createProduct).not.toHaveBeenCalled();
  });
  it("crea con input válido", async () => {
    const onCreated = vi.fn();
    vi.mocked(createProduct).mockResolvedValue({ id: "p1", name: "A", price: 1 });
    render(productForm({ onCreated }));
    await userEvent.type(screen.getByLabelText("Nombre"), "A");
    await userEvent.type(screen.getByLabelText("Precio"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onCreated).toHaveBeenCalled();
  });
});
```

`getAllByRole("alert")` solo encuentra los mensajes visibles: los ocultos (`hidden`) no cuentan. Para la API, mockea `fetch` con `vi.spyOn(globalThis, "fetch")` y prueba `api.ts`: respuesta válida, forma inesperada (falla el schema) y 401. Nunca uses la red real.
