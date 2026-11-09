---
name: react-patterns
description: Código de referencia seguro para una feature de la SPA React + Vite - schema Zod, llamada a la API con apiFetch, hook de datos con cancelación, store Zustand, formulario controlado, página delgada y tests con Vitest y Testing Library. Úsala SIEMPRE antes de escribir schemas, api, hooks, stores, componentes, páginas o tests de una feature, para copiar el patrón del proyecto en vez de inventar uno.
---

# react-patterns

Copia la forma, cambia los nombres. Ejemplo con la feature `products`. `src/lib/api.ts` (orquestador) exporta `apiFetch(path, schema, init)` y `ApiError`; lo crea `make new-app`. Sesión y login: `references/auth.md`.

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

export function listProducts(signal?: AbortSignal) {
  return apiFetch("/products", productListSchema, { signal });
}

export function createProduct(input: CreateProductInput) {
  return apiFetch("/products", productSchema, { method: "POST", body: JSON.stringify(input) });
}
```

## hooks/useProducts.ts — logic-writer

```ts
import { useCallback, useEffect, useState } from "react";
import { listProducts } from "../api";
import type { Product } from "../schemas";

export function useProducts() {
  const [data, setData] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController(); // cancela la petición si el componente se desmonta
    setLoading(true);
    listProducts(ctrl.signal)
      .then((rows) => { setData(rows); setError(null); })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Error"); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
```

## stores.ts — logic-writer (solo si el contrato lo pide)

```ts
import { create } from "zustand"; // dependencia nueva: pídela al orquestador

type ProductFilters = { query: string; setQuery: (q: string) => void; reset: () => void };

export const useProductFilters = create<ProductFilters>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
  reset: () => set({ query: "" }),
}));
```

## components/ProductForm.tsx — ui-writer

```tsx
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { createProduct } from "../api";
import { createProductSchema } from "../schemas";

export function ProductForm({ onCreated }: { onCreated: () => void }) {
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = createProductSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(z.flattenError(parsed.error).fieldErrors);
    setErrors({}); setError(null); setPending(true);
    try { await createProduct(parsed.data); onCreated(); }
    catch { setError("No se pudo crear el producto"); } // sin detalles internos
    finally { setPending(false); }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="name">Nombre</label>
      <input id="name" name="name" maxLength={120} aria-invalid={!!errors.name} />
      {errors.name && <p role="alert">{errors.name[0]}</p>}
      <label htmlFor="price">Precio</label>
      <input id="price" name="price" type="number" step="0.01" />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
    </form>
  );
}
```

## pages/ProductsPage.tsx e index.ts — ui-writer

```tsx
// Página delgada: compone componentes y hooks, no decide.
import { ProductForm } from "../components/ProductForm";
import { useProducts } from "../hooks/useProducts";

export function ProductsPage() {
  const { data, error, loading, reload } = useProducts();
  if (loading) return <p>Cargando…</p>;
  if (error) return <p role="alert">{error}</p>;
  return (
    <>
      <ul>{data.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
      <ProductForm onCreated={reload} />
    </>
  );
}
```

```ts
// src/features/products/index.ts — lo único que otras features (y App.tsx) importan
export { ProductsPage } from "./pages/ProductsPage";
export type { Product } from "./schemas";
```

## Test — qa-writer (`tests/features/products/ProductForm.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../../../src/features/products/api", () => ({ createProduct: vi.fn() }));

import { createProduct } from "../../../src/features/products/api";
import { ProductForm } from "../../../src/features/products/components/ProductForm";

describe("ProductForm", () => {
  it("muestra errores y no llama a la API con input inválido", async () => {
    render(<ProductForm onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(createProduct).not.toHaveBeenCalled();
  });
  it("crea con input válido", async () => {
    const onCreated = vi.fn();
    vi.mocked(createProduct).mockResolvedValue({ id: "p1", name: "A", price: 1 });
    render(<ProductForm onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText("Nombre"), "A");
    await userEvent.type(screen.getByLabelText("Precio"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onCreated).toHaveBeenCalled();
  });
});
```

Para la API, mockea `fetch` con `vi.spyOn(globalThis, "fetch")` y prueba `api.ts`: respuesta válida, forma inesperada (falla el schema) y 401. Nunca uses la red real.
