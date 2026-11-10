// Shown when no route matches (ui-writer zone).
import { h } from "../lib/dom";

export function notFoundPage(): HTMLElement {
  return h("main", {}, h("h1", {}, "Página no encontrada"), h("a", { href: "/" }, "Volver al inicio"));
}
