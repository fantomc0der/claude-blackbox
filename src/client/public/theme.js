(() => {
  let theme = "dark";
  try { if (localStorage.getItem("blackbox:theme") === "light") theme = "light"; }
  catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#efefed" : "#101214");
})();
