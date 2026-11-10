// Route table (orchestrator zone). Each feature exports its pages from its index.ts; register them here.
// Example: import { productsPage } from "./features/products";  →  "/products": productsPage,
import type { Routes } from "./lib/router";
import { homePage } from "./pages/home";
import { notFoundPage } from "./pages/not-found";

export const routes: Routes = {
  "/": homePage,
};

export { notFoundPage };
