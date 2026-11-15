// NIPOS as a Home Screen app (iPhone and iPad: Safari, Share, Add to Home Screen).
//  - Shows each page's "All apps" button, back to the NIPOS start screen.
//  - Opened in Safari on an iPhone or iPad: a small banner offering the install steps, which can be
//    closed (it stays away for two weeks on that device).
(function () {
  var standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var KEY = "nipos.installPromptClosedAt", AWAY = 14 * 864e5;
  function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }
  ready(function () {
    document.querySelectorAll("[data-app-home]").forEach(function (el) { el.hidden = false; });
    if (standalone) return;
    if (!ios || /install\.html$/.test(location.pathname)) return;
    var closedAt = 0;
    try { closedAt = Number(localStorage.getItem(KEY)) || 0; } catch (e) {}
    if (Date.now() - closedAt < AWAY) return;
    var bar = document.createElement("div");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Install NIPOS");
    bar.style.cssText = "position:fixed;left:max(10px, env(safe-area-inset-left));right:max(10px, env(safe-area-inset-right));bottom:max(10px, env(safe-area-inset-bottom));z-index:2147483000;display:flex;align-items:center;gap:10px;padding:10px 10px 10px 16px;border-radius:14px;background:var(--surface, #13212f);color:var(--text, #eef4f8);border:1px solid var(--border, #253d52);box-shadow:0 10px 30px -10px rgba(0,0,0,.6);font:600 15px/1.3 'Atkinson Hyperlegible Next',-apple-system,sans-serif;max-width:560px;margin:0 auto;";
    bar.innerHTML = '<span style="flex:1;min-width:0;">Put NIPOS on your Home Screen, so it opens like an app.</span>'
      + '<a href="install.html" style="display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:10px;background:var(--accent, #f0a13a);color:var(--accent-ink, #2b1a02);font-weight:800;text-decoration:none;">How</a>'
      + '<button type="button" aria-label="Close" style="min-width:44px;min-height:44px;border:0;border-radius:10px;background:transparent;color:inherit;font-size:22px;cursor:pointer;">×</button>';
    bar.querySelector("button").addEventListener("click", function () {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      bar.remove();
    });
    document.body.appendChild(bar);
  });
})();
