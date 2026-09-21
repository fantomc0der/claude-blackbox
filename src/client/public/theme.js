(() => {
  let theme = "dark";
  try { if (localStorage.getItem("blackbox:theme") === "light") theme = "light"; }
  catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#efefed" : "#101214");
  let readingWidth = "full";
  try { if (localStorage.getItem("blackbox:reading-width") === "comfortable") readingWidth = "comfortable"; }
  catch {}
  document.documentElement.dataset.readingWidth = readingWidth;
})();
