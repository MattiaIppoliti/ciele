/**
 * Ciele embeddable widget (floater button + chat iframe).
 *
 * <script src="https://YOUR-APP/widget.js"
 *         data-assistant="ASSISTANT_ID"
 *         data-collection="COLLECTION_ID"   (optional context hint)
 *         data-color="#0a0a0a"              (optional override)
 *         data-position="right|left"        (optional override)
 *         data-mode="card|drawer"           (optional; card = floating
 *                                            rounded panel, drawer = flush
 *                                            full-height side panel)
 *         data-theme="light|dark|system"    (optional; default: follow host)
 *         async></script>
 *
 * Theme: without data-theme the widget follows the embedding page's theme
 * (host <html> class="dark"/data-theme, else the OS preference) and tracks
 * later toggles live. Set data-theme to pin one.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var assistantId = script.getAttribute("data-assistant");
  if (!assistantId) return;
  var base = new URL(script.src).origin;
  var collection = script.getAttribute("data-collection") || "";

  // Warm the connection to the app origin right away — DNS + TLS are done
  // by the time the config fetch and the chat iframe need them.
  var preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = base;
  document.head.appendChild(preconnect);

  var state = { open: false, fullscreen: false };
  var color = script.getAttribute("data-color") || "#0a0a0a";
  var position = script.getAttribute("data-position") || "right";
  var mode = script.getAttribute("data-mode") === "drawer" ? "drawer" : "card";

  // Match the embedding page's light/dark theme. The chat iframe is a separate
  // origin and can't read the host's theme, so we detect it here and forward
  // it: initially via the `?theme=` param, and on later host toggles via a
  // postMessage the widget listens for. `data-theme="light|dark|system"` on the
  // script pins it; otherwise we sniff the host <html> (class="dark" or
  // data-theme, used by Tailwind/next-themes and most theme toggles), falling
  // back to the OS preference.
  var themeAttr = script.getAttribute("data-theme");
  function detectTheme() {
    if (themeAttr) return themeAttr;
    var root = document.documentElement;
    if (root.classList.contains("dark")) return "dark";
    if (root.classList.contains("light")) return "light";
    var dataTheme = root.getAttribute("data-theme");
    if (dataTheme === "dark" || dataTheme === "light") return dataTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  // The color the iframe chrome shows before the chat's own background paints —
  // dark when the host is dark so there's no white flash on a dark page.
  function frameBackground() {
    return detectTheme() === "dark" ? "#121212" : "#f5f5f5";
  }

  var button = document.createElement("button");
  button.setAttribute("aria-label", "Open chat");
  var frame = document.createElement("iframe");
  var src = base + "/widget/" + encodeURIComponent(assistantId);
  var query = "?theme=" + encodeURIComponent(detectTheme());
  if (collection) query += "&c=" + encodeURIComponent(collection);
  // The page the visitor is on. The chat is a cross-origin iframe, so its own
  // referer describes us, not the host page — URL Flow Conditions (and the
  // Inbox's Launch URL) need the host to say. Capped like the server does.
  var pageUrl = String(window.location.href).slice(0, 500);
  query += "&u=" + encodeURIComponent(pageUrl);
  src += query;
  frame.title = "Chat assistant";
  frame.allow = "clipboard-write";

  // The chat iframe is the whole app — don't make every host-page view pay
  // for it up front. It loads when the browser is idle after the host page
  // finishes (so it never competes with the page's own load), and
  // immediately on hover/focus of the launcher (intent = warm it now).
  var frameLoaded = false;
  function warmFrame() {
    if (frameLoaded || !frame.isConnected) return;
    frameLoaded = true;
    frame.src = src;
  }
  function warmWhenIdle() {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(warmFrame, { timeout: 4000 });
    } else {
      setTimeout(warmFrame, 2500);
    }
  }
  if (document.readyState === "complete") {
    warmWhenIdle();
  } else {
    window.addEventListener("load", warmWhenIdle, { once: true });
  }

  function applyStyles() {
    var side = position === "left" ? "left:24px;" : "right:24px;";
    button.style.cssText =
      "position:fixed;bottom:24px;" + side +
      "z-index:2147483000;width:56px;height:56px;border-radius:50%;border:none;" +
      "cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);background:" + color +
      ";color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .15s;";
    var bg = frameBackground();
    var display = "display:" + (state.open ? "block" : "none") + ";";
    if (state.fullscreen) {
      // The chat asked to go full screen (its header's ⋯ menu): cover the
      // whole viewport regardless of mode until it posts ciele:restore.
      frame.style.cssText =
        "position:fixed;inset:0;z-index:2147483000;width:100%;height:100%;" +
        "border:none;border-radius:0;background:" + bg + ";" + display;
    } else if (mode === "drawer") {
      // Flush full-height side panel (like a docs "Ask AI" drawer).
      var drawerSide = position === "left"
        ? "left:0;border-right:1px solid rgba(0,0,0,.12);"
        : "right:0;border-left:1px solid rgba(0,0,0,.12);";
      frame.style.cssText =
        "position:fixed;top:0;bottom:0;" + drawerSide +
        "z-index:2147483000;width:min(400px,100vw);height:100vh;border-radius:0;" +
        "box-shadow:0 8px 40px rgba(0,0,0,.28);background:" + bg + ";" + display;
    } else {
      // Floating rounded card above the launcher (default).
      frame.style.cssText =
        "position:fixed;bottom:92px;" + side +
        "z-index:2147483000;width:380px;height:min(640px,calc(100vh - 120px));" +
        "border:none;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.28);" +
        "background:" + bg + ";" + display;
    }
  }

  // Forward later host theme changes (a light/dark toggle on the embedding
  // page) to the already-loaded iframe — its src can't be re-read, so the
  // widget applies `ciele:theme` messages live. Only meaningful when the host
  // hasn't pinned a theme via data-theme.
  var lastTheme = detectTheme();
  function syncTheme() {
    var theme = detectTheme();
    if (theme === lastTheme) return;
    lastTheme = theme;
    applyStyles(); // refresh the pre-paint frame background
    if (frameLoaded && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "ciele:theme", theme: theme }, "*");
    }
  }
  if (!themeAttr) {
    var themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    var themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    if (themeMedia.addEventListener) {
      themeMedia.addEventListener("change", syncTheme);
    } else if (themeMedia.addListener) {
      themeMedia.addListener(syncTheme); // Safari < 14
    }
  }

  var chatIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function render() {
    button.innerHTML = state.open ? closeIcon : chatIcon;
    applyStyles();
  }

  button.addEventListener("click", function () {
    warmFrame(); // touch devices skip hover — make sure the frame loads
    state.open = !state.open;
    render();
  });
  button.addEventListener("mouseenter", function () {
    warmFrame();
    button.style.transform = "scale(1.06)";
  });
  button.addEventListener("focus", warmFrame);
  button.addEventListener("mouseleave", function () {
    button.style.transform = "scale(1)";
  });
  window.addEventListener("message", function (event) {
    if (event.data === "ciele:close" || event.data === "agent-hub:close") {
      state.open = false;
      state.fullscreen = false;
      render();
    } else if (event.data === "ciele:fullscreen") {
      state.fullscreen = true;
      render();
    } else if (event.data === "ciele:restore") {
      state.fullscreen = false;
      render();
    }
  });

  // Pull published style (launcher color/position/enabled) from the config.
  fetch(base + "/api/widget/" + encodeURIComponent(assistantId) + "/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (config) {
      if (!config) return;
      if (config.chatLauncherEnabled === false) {
        button.remove();
        frame.remove();
        return;
      }
      if (!script.getAttribute("data-color") && config.style && config.style.brandColor) {
        color = config.style.brandColor;
      }
      if (!script.getAttribute("data-position") && config.style && config.style.position) {
        position = config.style.position;
      }
      render();
    })
    .catch(function () {});

  render();
  document.body.appendChild(frame);
  document.body.appendChild(button);
})();
