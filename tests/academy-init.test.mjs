import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  academyInitScript as initScript,
  themeStorageKey,
} from "./academy-script.mjs";

const defaultCapability = JSON.parse(
  readFileSync(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  ),
);

test("the app shell is permitted to hide and dispose its native child webview", () => {
  assert.ok(defaultCapability.permissions.includes("allow-dispose-web-view"));
  assert.ok(defaultCapability.permissions.includes("allow-hide-web-view"));
  assert.ok(defaultCapability.permissions.includes("allow-sign-out"));
});

function runAcademyScript(
  view = "embedded",
  restore = null,
  lessonLogos = [],
  documentReady = true,
  courseBackLinks = [],
  theme = "dark",
  siteNavigation = [],
  storageEntries = [],
  mediaElements = [],
  pageUrl = "https://academy.zerotomastery.io/courses/enrolled/697434",
  frames = [],
  topWindow = null,
) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const styles = new Map();
  const invokes = [];
  const storage = new Map(storageEntries);
  const sessionStorage = new Map();
  const scrollCalls = [];
  const documentListenerRegistrations = [];
  const windowListenerRegistrations = [];
  const document = {
    readyState: documentReady ? "complete" : "loading",
    fullscreenElement: null,
    webkitFullscreenElement: null,
    documentElement: documentReady
      ? {
          appendChild: (element) => styles.set(element.id, element),
          classList: { contains: () => false, toggle() {} },
          dataset: {},
          style: {},
        }
      : null,
    head: documentReady
      ? { appendChild: (element) => styles.set(element.id, element) }
      : null,
    getElementById: (id) => styles.get(id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
    querySelector: (selector) =>
      selector === "video, audio" ? (mediaElements[0] ?? null) : null,
    querySelectorAll: (selector) => {
      if (selector === ".ztm-sidebar, .ztm-sidebar-links") {
        return siteNavigation;
      }
      if (selector === "video, audio") return mediaElements;
      if (selector === "iframe") return frames;
      return selector.startsWith("img[") ? lessonLogos : courseBackLinks;
    },
    addEventListener: (name, listener) => {
      documentListenerRegistrations.push(name);
      documentListeners.set(name, listener);
    },
  };
  const window = {
    __ZTM_DESKTOP_VIEW__: view,
    __ZTM_DESKTOP_RESTORE__: restore,
    __ZTM_DESKTOP_THEME__: theme,
    __TAURI_INTERNALS__: {
      invoke: (command, args) => {
        invokes.push({ command, args });
        return Promise.resolve();
      },
    },
    sessionStorage: {
      getItem: (key) => sessionStorage.get(key) ?? null,
      setItem: (key, value) => sessionStorage.set(key, value),
    },
    scrollX: 12,
    scrollY: 34,
    scrollTo: (x, y) => scrollCalls.push({ x, y }),
    addEventListener: (name, listener) => {
      windowListenerRegistrations.push(name);
      windowListeners.set(name, listener);
    },
  };
  window.top = topWindow ?? window;
  const initialUrl = new URL(pageUrl);
  const location = {
    hostname: initialUrl.hostname,
    href: initialUrl.href,
    pathname: initialUrl.pathname,
    replace(url) {
      this.href = url;
      this.pathname = new URL(url).pathname;
    },
  };

  const context = {
    Boolean,
    console,
    document,
    location,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
    },
    URL,
    window,
  };
  const evaluate = () => vm.runInNewContext(initScript, context);
  evaluate();

  return {
    document,
    documentListenerRegistrations,
    documentListeners,
    evaluate,
    invokes,
    location,
    scrollCalls,
    storage,
    styles,
    window,
    windowListenerRegistrations,
    windowListeners,
  };
}

test("initialization survives running before the document element exists", () => {
  const runtime = runAcademyScript("fullscreen", null, [], false);

  assert.equal(runtime.styles.size, 0);
  assert.equal(typeof runtime.documentListeners.get("DOMContentLoaded"), "function");

  runtime.document.documentElement = {
    appendChild: (element) => runtime.styles.set(element.id, element),
    classList: { contains: () => false, toggle() {} },
    dataset: {},
    style: {},
  };
  runtime.document.head = {
    appendChild: (element) => runtime.styles.set(element.id, element),
  };
  runtime.documentListeners.get("DOMContentLoaded")();

  assert.ok(runtime.styles.has("ztm-desktop-app-style"));
});

test("initialization setup runs immediately after the document has loaded", () => {
  const restore = {
    url: "https://academy.zerotomastery.io/courses/enrolled/697434",
    scrollX: 45,
    scrollY: 900,
    mediaTime: null,
    mediaPaused: null,
    playbackRate: null,
  };

  const runtime = runAcademyScript("embedded", restore);

  assert.ok(runtime.styles.has("ztm-desktop-app-style"));
  assert.deepEqual(runtime.scrollCalls, [{ x: 45, y: 900 }]);
});

test("evaluating the initialization script twice is a no-op", () => {
  const runtime = runAcademyScript();
  const documentListeners = runtime.documentListenerRegistrations.length;
  const windowListeners = runtime.windowListenerRegistrations.length;

  runtime.evaluate();

  assert.equal(runtime.documentListenerRegistrations.length, documentListeners);
  assert.equal(runtime.windowListenerRegistrations.length, windowListeners);
  assert.equal(runtime.styles.size, 1);
});

test("embedded fullscreen invokes the native promotion command once per transition", () => {
  const runtime = runAcademyScript();
  runtime.document.fullscreenElement = {};

  runtime.documentListeners.get("fullscreenchange")();
  runtime.documentListeners.get("fullscreenchange")();

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.invokes)), [
    {
      command: "web_view_fullscreen",
      args: {
        fullscreen: true,
        session: {
          url: "https://academy.zerotomastery.io/courses/enrolled/697434",
          scrollX: 12,
          scrollY: 34,
          mediaTime: null,
          mediaPaused: null,
          playbackRate: null,
        },
      },
    },
  ]);
});

test("embedded Academy CSS only controls the app-selected palette", () => {
  const runtime = runAcademyScript();
  const style = runtime.styles.get("ztm-desktop-app-style");

  assert.match(style.textContent, /color-scheme: dark !important/);
  assert.match(style.textContent, /data-ztm-dark-surface/);
  assert.doesNotMatch(style.textContent, /display:\s*none/);
  assert.doesNotMatch(style.textContent, /ztm-sidebar/);
  assert.equal(runtime.styles.size, 1);
});

test("fullscreen Academy CSS leaves navigation removal to the DOM observer", () => {
  const runtime = runAcademyScript("fullscreen");
  const style = runtime.styles.get("ztm-desktop-app-style");

  assert.match(style.textContent, /color-scheme: dark !important/);
  assert.doesNotMatch(style.textContent, /display:\s*none/);
});

test("Academy course navigation is structurally removed", () => {
  let removals = 0;
  const navigation = {
    closest: () => null,
    remove: () => (removals += 1),
  };

  runAcademyScript("embedded", null, [], true, [], "dark", [navigation]);

  assert.equal(removals, 1);
});

test("the Academy document uses the app-selected theme", () => {
  const runtime = runAcademyScript("fullscreen", null, [], true, [], "light");

  assert.equal(runtime.document.documentElement.dataset.theme, "light");
  assert.equal(runtime.document.documentElement.style.colorScheme, "light");
  assert.match(
    runtime.styles.get("ztm-desktop-app-style").textContent,
    /color-scheme: light !important/,
  );
});

test("a live theme change is retained for the webview reset reload", () => {
  const runtime = runAcademyScript("fullscreen", null, [], true, [], "dark");

  runtime.window.__ZTM_DESKTOP_SET_THEME__("light");

  assert.equal(
    runtime.window.sessionStorage.getItem(themeStorageKey),
    "light",
  );
});

test("course overview detection supports every enrolled course identifier", () => {
  assert.match(
    initScript,
    /courses\\\/\(\?:enrolled\\\/\)\?\[\^\/\]\+/,
    "the dark overview palette must cover /courses/enrolled/{id}",
  );
});

test("palette normalization includes the Academy dashboard and categories", () => {
  assert.match(initScript, /location\.pathname === "\/"/);
  assert.match(initScript, /courses\\\/category/);
  assert.match(initScript, /ztmLightSurface/);
  assert.match(initScript, /ztm-light-palette/);
});

test("authentication pages are left untouched", () => {
  for (const [path, authentication] of [
    ["/sign_in", true],
    ["/users/sign_in", true],
    ["/courses/identity-theory", false],
    ["/courses/enrolled/697434", false],
  ]) {
    const url = `https://academy.zerotomastery.io${path}`;
    const runtime = runAcademyScript(
      "window",
      null,
      [],
      true,
      [],
      "dark",
      [],
      [],
      [],
      url,
    );

    assert.equal(runtime.styles.size === 0, authentication, url);
    assert.equal(runtime.documentListeners.size === 0, authentication, url);
    assert.equal(runtime.windowListeners.size === 0, authentication, url);
  }

  const teachable = runAcademyScript(
    "window",
    null,
    [],
    true,
    [],
    "dark",
    [],
    [],
    [],
    "https://sso.teachable.com/secure/123/identity/login/password",
  );
  assert.equal(teachable.styles.size, 0);
  assert.equal(teachable.documentListeners.size, 0);
  assert.equal(teachable.windowListeners.size, 0);
});

test("the Academy lesson header cannot navigate home before it is hidden", () => {
  const runtime = runAcademyScript();
  let prevented = false;
  let stopped = false;
  const nav = {};
  const link = {
    closest: (selector) => (selector === "div.nav" ? nav : null),
    querySelector: () => ({}),
  };

  runtime.documentListeners.get("click")({
    target: { closest: () => link },
    preventDefault: () => (prevented = true),
    stopImmediatePropagation: () => (stopped = true),
  });

  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test("the fullscreen Academy logo returns to the embedded app with its session", () => {
  const runtime = runAcademyScript("fullscreen");
  const nav = {};
  const link = {
    closest: (selector) => (selector === "div.nav" ? nav : null),
    querySelector: () => ({}),
  };

  runtime.documentListeners.get("click")({
    target: { closest: () => link },
    preventDefault() {},
    stopImmediatePropagation() {},
  });

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.invokes)), [
    {
      command: "web_view_fullscreen",
      args: {
        fullscreen: false,
        session: {
          url: "https://academy.zerotomastery.io/courses/enrolled/697434",
          scrollX: 12,
          scrollY: 34,
          mediaTime: null,
          mediaPaused: null,
          playbackRate: null,
        },
      },
    },
  ]);
});

test("the Academy lesson header is structurally removed", () => {
  let removed = false;
  const nav = { remove: () => (removed = true) };
  const link = { parentElement: nav };
  const logo = {
    closest: (selector) => (selector === "div.nav" ? nav : link),
  };

  runAcademyScript("embedded", null, [logo]);

  assert.equal(removed, true);
});

test("the fullscreen Academy home link is converted into an exit control", () => {
  const attributes = new Map([["href", "/"]]);
  const nav = {};
  const link = {
    dataset: {},
    closest: (selector) => (selector === "div.nav" ? nav : null),
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const logo = {
    closest: (selector) => (selector === "a" ? link : nav),
  };

  runAcademyScript("fullscreen", null, [logo]);

  assert.equal(attributes.has("href"), false);
  assert.equal(link.dataset.ztmFullscreenExit, "true");
  assert.equal(attributes.get("role"), "button");
  assert.equal(attributes.get("title"), "Return to ZTM Desktop");
});

test("the fullscreen curriculum link is converted into an exit control", () => {
  const attributes = new Map([["href", "/courses/697434"]]);
  const link = {
    dataset: {},
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name, value) => attributes.set(name, value),
  };

  runAcademyScript("fullscreen", null, [], true, [link]);

  assert.equal(attributes.has("href"), false);
  assert.equal(link.dataset.ztmFullscreenExit, "true");
  assert.equal(attributes.get("title"), "Return to ZTM Desktop");
});

test("Escape from the promoted window requests its disposal", () => {
  const runtime = runAcademyScript("fullscreen");

  runtime.windowListeners.get("keydown")({ key: "Escape" });

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.invokes)), [
    {
      command: "web_view_fullscreen",
      args: {
        fullscreen: false,
        session: {
          url: "https://academy.zerotomastery.io/courses/enrolled/697434",
          scrollX: 12,
          scrollY: 34,
          mediaTime: null,
          mediaPaused: null,
          playbackRate: null,
        },
      },
    },
  ]);
});

test("native fullscreen exit captures playback before disposing its window", () => {
  const media = {
    currentTime: 187.25,
    paused: false,
    playbackRate: 1.5,
    readyState: 1,
    addEventListener() {},
  };
  const runtime = runAcademyScript(
    "fullscreen",
    null,
    [],
    true,
    [],
    "dark",
    [],
    [],
    [media],
  );

  runtime.window.__ZTM_DESKTOP_EXIT_FULLSCREEN__();

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.invokes)), [
    {
      command: "web_view_fullscreen",
      args: {
        fullscreen: false,
        session: {
          url: "https://academy.zerotomastery.io/courses/enrolled/697434",
          scrollX: 12,
          scrollY: 34,
          mediaTime: 187.25,
          mediaPaused: false,
          playbackRate: 1.5,
        },
      },
    },
  ]);
});

test("a transferred session restores the page position", () => {
  const restore = {
    url: "https://academy.zerotomastery.io/courses/enrolled/697434",
    scrollX: 45,
    scrollY: 900,
    mediaTime: null,
    mediaPaused: null,
    playbackRate: null,
  };
  const runtime = runAcademyScript("embedded", restore);

  assert.deepEqual(runtime.scrollCalls, [{ x: 45, y: 900 }]);
});

test("a URL-only fullscreen fallback retains the durable playback checkpoint", () => {
  const url = "https://academy.zerotomastery.io/courses/enrolled/697434";
  const saved = {
    url,
    scrollX: 45,
    scrollY: 900,
    mediaTime: 142.75,
    mediaPaused: true,
    playbackRate: 1.5,
  };
  const fallback = {
    url,
    scrollX: 0,
    scrollY: 0,
    mediaTime: null,
    mediaPaused: null,
    playbackRate: null,
  };
  const mediaListeners = new Map();
  const media = {
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    readyState: 1,
    addEventListener: (name, listener) => mediaListeners.set(name, listener),
    pause() {},
    play: () => Promise.resolve(),
  };
  const progress = JSON.stringify({ "course:697434": saved });
  const runtime = runAcademyScript(
    "embedded",
    fallback,
    [],
    true,
    [],
    "dark",
    [],
    [["ztm-desktop-course-progress-v2", progress]],
    [media],
  );

  assert.equal(media.currentTime, 142.75);
  assert.equal(media.playbackRate, 1.5);
});

test("only course-content webviews initialize the progress relay in every frame", () => {
  const rust = readFileSync(
    new URL("../src-tauri/src/web_view.rs", import.meta.url),
    "utf8",
  );

  assert.equal(
    rust.match(/initialization_script_for_all_frames/g)?.length,
    3,
  );
  const authenticationWindow = rust.slice(
    rust.indexOf("fn build_authentication_window"),
    rust.indexOf("pub async fn sign_out"),
  );
  assert.doesNotMatch(authenticationWindow, /initialization_script_for_all_frames/);
});

test("sign-out removes cookies without erasing saved Academy progress", () => {
  const rust = readFileSync(
    new URL("../src-tauri/src/web_view.rs", import.meta.url),
    "utf8",
  );
  const signOut = rust.slice(
    rust.indexOf("pub async fn sign_out"),
    rust.indexOf("fn show_course_window"),
  );

  assert.match(signOut, /delete_cookie/);
  assert.doesNotMatch(signOut, /clear_all_browsing_data/);
});

test("the desktop pause hook pauses top-frame media and notifies frames", () => {
  let pauses = 0;
  const messages = [];
  const media = {
    currentTime: 12,
    paused: false,
    playbackRate: 1,
    readyState: 1,
    addEventListener() {},
    pause() {
      pauses += 1;
      this.paused = true;
    },
  };
  const frame = {
    contentWindow: {
      postMessage: (message) => messages.push(message),
    },
  };
  const runtime = runAcademyScript(
    "embedded",
    null,
    [],
    true,
    [],
    "dark",
    [],
    [],
    [media],
    "https://academy.zerotomastery.io/courses/enrolled/697434",
    [frame],
  );

  runtime.window.__ZTM_DESKTOP_PAUSE__();
  runtime.window.__ZTM_DESKTOP_PAUSE__();

  assert.equal(media.paused, true);
  assert.equal(pauses, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { type: "ztm-desktop-media-pause" },
    { type: "ztm-desktop-media-pause" },
  ]);
});

test("player frames pause playing media on the desktop pause message", () => {
  let pauses = 0;
  const media = {
    currentTime: 34,
    paused: false,
    playbackRate: 1,
    readyState: 1,
    addEventListener() {},
    pause() {
      pauses += 1;
      this.paused = true;
    },
  };
  const topWindow = { postMessage() {} };
  const runtime = runAcademyScript(
    "embedded",
    null,
    [],
    true,
    [],
    "dark",
    [],
    [],
    [media],
    "https://player.example/video",
    [],
    topWindow,
  );

  runtime.windowListeners.get("message")({
    source: topWindow,
    data: { type: "ztm-desktop-media-pause" },
  });
  runtime.windowListeners.get("message")({
    source: topWindow,
    data: { type: "ztm-desktop-media-pause" },
  });

  assert.equal(media.paused, true);
  assert.equal(pauses, 1);
});
