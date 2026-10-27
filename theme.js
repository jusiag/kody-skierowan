/* Motyw: automatyczny (jak w telefonie), jasny albo ciemny. Wybór jest pamiętany na tym urządzeniu. */
(function () {
  var KEY = "kody-motyw", root = document.documentElement;
  function get() { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } }
  function apply(m) {
    if (m === "light" || m === "dark") root.setAttribute("data-theme", m); else root.removeAttribute("data-theme");
  }
  apply(get());
  var ICON = { auto: "◐", light: "☀", dark: "☾" };
  var NAME = { auto: "automatyczny", light: "jasny", dark: "ciemny" };
  function label(btn, m) {
    btn.textContent = ICON[m];
    btn.setAttribute("aria-label", "Motyw: " + NAME[m] + ". Dotknij, aby zmienić.");
    btn.title = "Motyw: " + NAME[m];
  }
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("themeBtn"); if (!btn) return;
    label(btn, get());
    btn.addEventListener("click", function () {
      var next = { auto: "light", light: "dark", dark: "auto" }[get()];
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next); label(btn, next);
    });
  });
})();
