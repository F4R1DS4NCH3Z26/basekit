// Minimal observable store (orchestrator zone). A feature creates one in its stores.ts only when the contract asks
// for state shared by several components; local state stays inside the component.
export type Store<T extends object> = {
  get(): Readonly<T>;
  set(patch: Partial<T> | ((state: Readonly<T>) => Partial<T>)): void;
  /** Calls `fn` on every change. Returns the function that unsubscribes. */
  subscribe(fn: (state: Readonly<T>) => void): () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state: Readonly<T> = { ...initial };
  const listeners = new Set<(state: Readonly<T>) => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of [...listeners]) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
