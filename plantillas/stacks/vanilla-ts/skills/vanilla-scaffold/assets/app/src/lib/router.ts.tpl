// Client router on the History API (orchestrator zone). Routes live in src/routes.ts: a path pattern such as
// "/products/:id" maps to a page, a function that returns the element to show. nginx (prod) and Vite (dev) answer
// every unknown path with index.html, so a reload on a deep link works.
import { h, mount } from "./dom";

export type RouteContext = {
  params: Record<string, string>;
  query: URLSearchParams;
  /** Aborted when the user leaves the page: pass it to every request the page starts. */
  signal: AbortSignal;
};
export type Page = (ctx: RouteContext) => Node | Promise<Node>;
export type Routes = Record<string, Page>;

type Compiled = { regex: RegExp; keys: string[]; page: Page };

function compile(routes: Routes): Compiled[] {
  return Object.entries(routes).map(([pattern, page]) => {
    const keys: string[] = [];
    const source = pattern
      .split("/")
      .map((part) => {
        if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        keys.push(part.slice(1));
        return "([^/]+)";
      })
      .join("/");
    return { regex: new RegExp(`^${source}/?$`), keys, page };
  });
}

export function match(routes: Routes, pathname: string): { page: Page; params: Record<string, string> } | null {
  for (const { regex, keys, page } of compile(routes)) {
    const m = regex.exec(pathname);
    if (!m) continue;
    try {
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")]));
      return { page, params };
    } catch {
      return null; // malformed escape (%E0%A4%A): treated as not found
    }
  }
  return null;
}

/** Changes the URL and renders the new page without reloading. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Renders the current URL into `outlet` and follows navigation. Returns a function that stops the router. */
export function startRouter(outlet: Element, routes: Routes, notFound: Page): () => void {
  let current: AbortController | null = null;

  async function render(): Promise<void> {
    current?.abort();
    const ctrl = new AbortController();
    current = ctrl;
    const { pathname, search } = window.location;
    const found = match(routes, pathname);
    const ctx: RouteContext = { params: found?.params ?? {}, query: new URLSearchParams(search), signal: ctrl.signal };
    try {
      const node = await (found?.page ?? notFound)(ctx);
      if (!ctrl.signal.aborted) mount(outlet, node);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.error(e);
      mount(outlet, h("p", { role: "alert" }, "No se pudo cargar la página")); // never internal details
    }
  }

  // Same-origin links are handled by the router; external links, new tabs and downloads keep the browser default.
  function onClick(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest("a");
    if (!a || a.target || a.hasAttribute("download") || a.dataset.external !== undefined) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  }

  const onPop = () => void render();
  window.addEventListener("popstate", onPop);
  document.addEventListener("click", onClick);
  void render();
  return () => {
    current?.abort();
    window.removeEventListener("popstate", onPop);
    document.removeEventListener("click", onClick);
  };
}
