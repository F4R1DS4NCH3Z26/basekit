---
name: nextjs-patterns
description: Código de referencia seguro para una feature de Next.js App Router - schema Zod, service server-only, Server Action con auth y safeParse, formulario con useActionState, store Zustand, página delgada y test con Vitest. Úsala SIEMPRE antes de escribir schemas, services, actions, componentes, stores o tests de una feature, para copiar el patrón del proyecto en vez de inventar uno.
---

# nextjs-patterns

Copia la forma, cambia los nombres. Ejemplo con la feature `products`. `@/lib/auth` exporta `getSession()` y `requireUser()` (Better Auth: ver `references/auth.md`). Ajusta `@/lib/db` a lo que exista (búscalo con Grep).

## Tipo compartido (vive en `src/types/action.ts`, zona del orquestador)

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };
```

## schemas.ts — data-writer

```ts
import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.coerce.number().positive().max(1_000_000),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
```

## services.ts — data-writer

```ts
import "server-only"; // rompe el build si un Client Component lo importa
import { db } from "@/lib/db";
import type { CreateProductInput } from "./schemas";

export async function insertProduct(input: CreateProductInput, ownerId: string) {
  return db.product.create({
    data: { ...input, ownerId },             // ownerId viene de la sesión, nunca del form
    select: { id: true, name: true, price: true }, // solo campos del contrato
  });
}
```

## actions.ts — data-writer

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/types/action";
import { createProductSchema } from "./schemas";
import { insertProduct } from "./services";

export async function createProduct(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  // Una Server Action es un endpoint POST público: se protege aquí, no solo en la página o el middleware.
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "No autorizado" };

  const parsed = createProductSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos", fieldErrors: z.flattenError(parsed.error).fieldErrors };
    // Zod 3: parsed.error.flatten().fieldErrors
  }
  try {
    const product = await insertProduct(parsed.data, session.user.id);
    revalidatePath("/products");
    return { ok: true, data: { id: product.id } };
  } catch {
    return { ok: false, error: "No se pudo crear el producto" }; // sin detalles internos
  }
}
```

## components/ProductForm.tsx — ui-writer

```tsx
"use client";
import { useActionState } from "react";
import { createProduct } from "../actions";

export function ProductForm() {
  const [state, formAction, pending] = useActionState(createProduct, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="space-y-3">
      <input name="name" required maxLength={120} aria-invalid={!!errors?.name} />
      {errors?.name && <p role="alert">{errors.name[0]}</p>}
      <input name="price" type="number" step="0.01" required />
      {state && !state.ok && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
    </form>
  );
}
```

## index.ts y página — ui-writer

```ts
// src/features/products/index.ts — nada server-only aquí
export { ProductForm } from "./components/ProductForm";
export type { CreateProductInput } from "./schemas";
```

```tsx
// src/app/products/new/page.tsx — página delgada: compone, no decide
import { ProductForm } from "@/features/products";
export default function NewProductPage() {
  return <ProductForm />;
}
```

## stores.ts — logic-writer (solo si el contrato lo pide)

```ts
import { create } from "zustand";

type ProductFilters = { query: string; setQuery: (q: string) => void; reset: () => void };

export const useProductFilters = create<ProductFilters>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
  reset: () => set({ query: "" }),
}));
```

## Test — qa-writer (`tests/features/products/actions.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/features/products/services", () => ({ insertProduct: vi.fn() }));

import { getSession } from "@/lib/auth";
import { insertProduct } from "@/features/products/services";
import { createProduct } from "@/features/products/actions";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; };

describe("createProduct", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rechaza sin sesión", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect(await createProduct(null, form({ name: "A", price: "1" }))).toMatchObject({ ok: false });
  });
  it("devuelve fieldErrors con input inválido", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const r = await createProduct(null, form({ name: "", price: "-1" }));
    expect(r.ok).toBe(false);
    expect(insertProduct).not.toHaveBeenCalled();
  });
  it("crea con input válido", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(insertProduct).mockResolvedValue({ id: "p1", name: "A", price: 1 } as never);
    expect(await createProduct(null, form({ name: "A", price: "1" }))).toEqual({ ok: true, data: { id: "p1" } });
  });
});
```
