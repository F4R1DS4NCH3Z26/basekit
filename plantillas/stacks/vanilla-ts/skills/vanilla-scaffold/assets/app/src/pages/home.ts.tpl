// Start page (ui-writer zone): a page is a function that returns an element.
import { h } from "../lib/dom";

export function homePage(): HTMLElement {
  return h("main", {}, h("h1", {}, "Inicio"), h("p", {}, "SPA en TypeScript sin framework."));
}
