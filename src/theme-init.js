// Applies the reader's saved theme before the first paint (a classic script
// in <head>, so there is no light flash on a dark choice). "system" leaves
// data-theme unset and the stylesheets follow prefers-color-scheme.
(function () {
  try {
    const theme = globalThis.localStorage?.getItem("novel-tracker:theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // Storage can be unavailable (private windows); fall back to the system theme.
  }
})();
