import { createSignal, onSettled } from "solid-js";

export type Navigate = (values: Record<string, string | null>, replace?: boolean) => void;

export function createLocation() {
  const [params, setParams] = createSignal(new URLSearchParams(location.search));
  const navigate: Navigate = (values, replace = false) => {
    const next = new URL(location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    }
    if (next.href === location.href) return;
    history[replace ? "replaceState" : "pushState"](null, "", next);
    setParams(new URLSearchParams(next.search));
  };
  onSettled(() => {
    const update = () => setParams(new URLSearchParams(location.search));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  });
  return { params, navigate };
}
