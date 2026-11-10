---
name: vue-patterns
description: "Código de referencia seguro para una feature de la SPA Vue + Vite - schema Zod, llamada a la API con apiFetch, composable de datos con cancelación, store Pinia, formulario con v-model, página delgada y tests con Vitest y @vue/test-utils. Úsala SIEMPRE antes de escribir schemas, api, composables, stores, componentes, páginas o tests de una feature, para copiar el patrón del proyecto en vez de inventar uno."
---

# vue-patterns

Copia la forma, cambia los nombres. Ejemplo con la feature `products`. `src/lib/api.ts` (orquestador) exporta `apiFetch(path, schema, init)` y `ApiError`; lo crea `make new-app`. Componentes con `<script setup lang="ts">`. Sesión y login: `references/auth.md`.

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

## composables/useProducts.ts — logic-writer

```ts
import { onScopeDispose, ref, shallowRef } from "vue";
import { listProducts } from "../api";
import type { Product } from "../schemas";

export function useProducts() {
  const data = shallowRef<Product[]>([]);
  const error = ref<string | null>(null);
  const loading = ref(true);
  let ctrl: AbortController | undefined;

  async function reload() {
    ctrl?.abort(); // una sola petición en vuelo: cancela la anterior
    const current = (ctrl = new AbortController());
    loading.value = true;
    try {
      data.value = await listProducts(current.signal);
      error.value = null;
    } catch (e: unknown) {
      if (!current.signal.aborted) error.value = e instanceof Error ? e.message : "Error";
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }

  onScopeDispose(() => ctrl?.abort()); // cancela la petición si el componente se desmonta
  void reload();
  return { data, error, loading, reload };
}
```

## stores.ts — logic-writer (solo si el contrato lo pide)

```ts
// Pinia es una dependencia nueva: pídela al orquestador (instala `pinia` y agrega app.use(createPinia()) en main.ts).
import { defineStore } from "pinia";
import { ref } from "vue";

export const useProductFilters = defineStore("productFilters", () => {
  const query = ref("");
  const setQuery = (q: string) => { query.value = q; };
  const reset = () => { query.value = ""; };
  return { query, setQuery, reset };
});
```

## components/ProductForm.vue — ui-writer

```vue
<script setup lang="ts">
import { reactive, ref } from "vue";
import { z } from "zod";
import { createProduct } from "../api";
import { createProductSchema } from "../schemas";

const emit = defineEmits<{ created: [] }>();
const form = reactive({ name: "", price: "" as string | number });
const errors = ref<Record<string, string[] | undefined>>({});
const error = ref<string | null>(null);
const pending = ref(false);

async function onSubmit() {
  const parsed = createProductSchema.safeParse(form);
  if (!parsed.success) { errors.value = z.flattenError(parsed.error).fieldErrors; return; }
  errors.value = {}; error.value = null; pending.value = true;
  try { await createProduct(parsed.data); emit("created"); }
  catch { error.value = "No se pudo crear el producto"; } // sin detalles internos
  finally { pending.value = false; }
}
</script>

<template>
  <form novalidate @submit.prevent="onSubmit">
    <label for="name">Nombre</label>
    <input id="name" v-model="form.name" name="name" maxlength="120" :aria-invalid="!!errors.name" />
    <p v-if="errors.name" role="alert">{{ errors.name[0] }}</p>
    <label for="price">Precio</label>
    <input id="price" v-model="form.price" name="price" type="number" step="0.01" />
    <p v-if="errors.price" role="alert">{{ errors.price[0] }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="submit" :disabled="pending">{{ pending ? "Guardando…" : "Guardar" }}</button>
  </form>
</template>
```

## pages/ProductsPage.vue e index.ts — ui-writer

```vue
<!-- Página delgada: compone componentes y composables, no decide. -->
<script setup lang="ts">
import ProductForm from "../components/ProductForm.vue";
import { useProducts } from "../composables/useProducts";

const { data, error, loading, reload } = useProducts();
</script>

<template>
  <p v-if="loading">Cargando…</p>
  <p v-else-if="error" role="alert">{{ error }}</p>
  <template v-else>
    <ul><li v-for="p in data" :key="p.id">{{ p.name }}</li></ul>
    <ProductForm @created="reload" />
  </template>
</template>
```

```ts
// src/features/products/index.ts — lo único que otras features (y src/router/index.ts) importan
export { default as ProductsPage } from "./pages/ProductsPage.vue";
export type { Product } from "./schemas";
```

El orquestador registra la ruta en `src/router/index.ts`:
`{ path: "/products", component: () => import("../features/products").then((m) => m.ProductsPage) }`.

## Test — qa-writer (`tests/features/products/ProductForm.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
vi.mock("../../../src/features/products/api", () => ({ createProduct: vi.fn() }));

import { createProduct } from "../../../src/features/products/api";
import ProductForm from "../../../src/features/products/components/ProductForm.vue";

describe("ProductForm", () => {
  it("muestra errores y no llama a la API con input inválido", async () => {
    const wrapper = mount(ProductForm);
    await wrapper.get("form").trigger("submit");
    expect(wrapper.findAll('[role="alert"]')).not.toHaveLength(0);
    expect(createProduct).not.toHaveBeenCalled();
  });
  it("crea con input válido", async () => {
    vi.mocked(createProduct).mockResolvedValue({ id: "p1", name: "A", price: 1 });
    const wrapper = mount(ProductForm);
    await wrapper.get("#name").setValue("A");
    await wrapper.get("#price").setValue("1");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.emitted("created")).toHaveLength(1);
  });
});
```

Para la API, mockea `fetch` con `vi.spyOn(globalThis, "fetch")` y prueba `api.ts`: respuesta válida, forma inesperada (falla el schema) y 401. Para un composable, móntalo dentro de un componente de prueba (`defineComponent` + `setup`) para que `onScopeDispose` funcione. Nunca uses la red real.
