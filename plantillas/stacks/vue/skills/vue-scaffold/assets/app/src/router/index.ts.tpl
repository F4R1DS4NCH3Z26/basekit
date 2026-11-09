// SPA routes (orchestrator zone). Each feature page is imported from that feature's index.ts, never from its
// internal files. nginx sends every unknown path to index.html, so history mode works in prod.
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  // Demo page from create-vite; replace it with the first feature page.
  { path: "/", name: "home", component: () => import("../components/HelloWorld.vue") },
  // Example: { path: "/products", name: "products", component: () => import("../features/products").then((m) => m.ProductsPage) },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
