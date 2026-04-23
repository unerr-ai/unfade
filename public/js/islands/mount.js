// FILE: public/js/islands/mount.js
// UF-476: Client-side React island hydration.
// Scans for [data-island] containers and hydrates registered components.

(function () {
  "use strict";

  /** @type {Map<string, function>} */
  const registry = new Map();

  /**
   * Register a React component for island hydration.
   * @param {string} name - Component name (must match data-island attribute)
   * @param {function} Component - React component function/class
   */
  function registerIsland(name, Component) {
    registry.set(name, Component);
  }

  /**
   * Mount a single island by container element.
   * @param {HTMLElement} container
   */
  function mountIsland(container) {
    const name = container.dataset.island;
    if (!name) return;

    const Component = registry.get(name);
    if (!Component) {
      console.warn("[unfade-islands] No component registered for:", name);
      return;
    }

    let props = {};
    try {
      props = JSON.parse(container.dataset.islandProps || "{}");
    } catch (e) {
      console.error("[unfade-islands] Failed to parse props for:", name, e);
      return;
    }

    // Use React 19 createRoot API
    const React = window.React;
    const ReactDOM = window.ReactDOM;
    if (!React || !ReactDOM) {
      console.error("[unfade-islands] React/ReactDOM not loaded");
      return;
    }

    const root = ReactDOM.createRoot(container);
    root.render(React.createElement(Component, props));
    container.dataset.islandMounted = "true";
  }

  /**
   * Scan the DOM and mount all unmounted islands.
   */
  function mountAll() {
    const containers = document.querySelectorAll("[data-island]:not([data-island-mounted])");
    containers.forEach(mountIsland);
  }

  // Expose API on window
  window.__unfadeIslands = {
    register: registerIsland,
    mount: mountIsland,
    mountAll: mountAll,
  };

  // Auto-mount on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }

  // Re-mount after htmx swaps (new islands injected via htmx)
  document.addEventListener("htmx:afterSettle", mountAll);
})();
