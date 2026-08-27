/* =====================================================================
   WILLOW Event System — THEME
   Writes the saved colour scheme into CSS custom properties. Every page
   (index / console / display) calls Theme.apply() on load and on change.
   ===================================================================== */
(function () {
  var Store = window.WillowStore;

  var Theme = {
    apply: function (theme) {
      var t = theme || Store.get().theme || {};
      var root = document.documentElement;
      Object.keys(t).forEach(function (k) { root.style.setProperty('--w-' + k, t[k]); });
    },
    presetNames: function () { return Object.keys(window.WILLOW_CONFIG.presets); },
    usePreset: function (name) {
      var p = window.WILLOW_CONFIG.presets[name];
      if (!p) return;
      Store.set({ theme: Object.assign({}, p), preset: name });
    },
    setSlot: function (key, value) {
      var next = Object.assign({}, Store.get().theme);
      next[key] = value;
      Store.set({ theme: next, preset: 'Custom' });
    },
    restore: function () { Theme.usePreset(window.WILLOW_CONFIG.defaultPreset); }
  };

  Store.subscribe(function () { Theme.apply(); });
  Theme.apply();
  window.WillowTheme = Theme;
})();
