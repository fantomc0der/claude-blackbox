import { createSignal, onSettled } from "solid-js";
import { Icon } from "./icon";

type Theme = "dark" | "light";
const storageKey = "blackbox:theme";

export function ThemeControl() {
  const [theme, setTheme] = createSignal<Theme>(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const applyTheme = (value: Theme) => {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "light" ? "#efefed" : "#101214");
  };
  const changeTheme = (value: Theme) => {
    applyTheme(value);
    try { localStorage.setItem(storageKey, value); }
    catch {}
  };
  onSettled(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try { if (event.storageArea === localStorage) applyTheme(event.newValue === "light" ? "light" : "dark"); }
      catch {}
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  });

  return <fieldset class="theme-control"><legend>Theme</legend><div class="theme-options">
    <button type="button" aria-pressed={theme() === "dark" ? "true" : "false"} onClick={() => changeTheme("dark")}><Icon name="moon" size={15} />Dark</button>
    <button type="button" aria-pressed={theme() === "light" ? "true" : "false"} onClick={() => changeTheme("light")}><Icon name="sun" size={15} />Light</button>
  </div></fieldset>;
}
