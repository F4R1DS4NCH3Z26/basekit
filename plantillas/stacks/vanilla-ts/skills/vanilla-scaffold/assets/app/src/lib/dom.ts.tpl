// DOM helper shared by every component (orchestrator zone). Components are functions that return elements built
// with `h`: text always goes through text nodes, so data from the API or the user is never parsed as HTML.
type Child = Node | string | number | false | null | undefined;
type Listener = (event: Event) => void;
export type Attrs = Record<string, string | number | boolean | Listener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === "function") {
      if (!name.startsWith("on")) throw new Error(`h: solo los atributos on* aceptan funciones (${name})`);
      el.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(name, "");
    } else if (value !== false && value !== null && value !== undefined) {
      el.setAttribute(name, String(value));
    }
  }
  el.append(...toNodes(children));
  return el;
}

/** Replaces every child of `parent` (an empty list clears it). */
export function mount(parent: Element, ...children: (Child | Child[])[]): void {
  parent.replaceChildren(...toNodes(children));
}

function toNodes(children: (Child | Child[])[]): Node[] {
  return children
    .flat()
    .filter((c): c is Node | string | number => c !== false && c !== null && c !== undefined)
    .map((c) => (c instanceof Node ? c : document.createTextNode(String(c))));
}
