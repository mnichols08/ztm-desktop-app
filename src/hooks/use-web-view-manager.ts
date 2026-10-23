import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type Bounds = { x: number; y: number; width: number; height: number };

// Native child webviews always composite above the shell DOM. Leave a small
// temporary gutter so collapsed-sidebar tooltips can be seen beside the rail.
const SIDEBAR_TOOLTIP_GUTTER = 112;

/** Mirrors `PageSession` in src-tauri/src/web_view.rs. */
export type WebViewSession = {
  url: string;
  scrollX: number;
  scrollY: number;
  mediaTime: number | null;
  mediaPaused: boolean | null;
  playbackRate: number | null;
};

/** A page to load in the web view. `id` changes on every request, even for the same URL. */
export type WebViewRequest = {
  url: string;
  id: number;
  session?: WebViewSession;
};

function boundsOf(element: HTMLElement, sidebarTooltipOpen = false): Bounds {
  const rect = element.getBoundingClientRect();
  const gutter = sidebarTooltipOpen
    ? Math.min(SIDEBAR_TOOLTIP_GUTTER, rect.width)
    : 0;
  return {
    x: rect.left + gutter,
    y: rect.top,
    width: rect.width - gutter,
    height: rect.height,
  };
}

// Rust runs commands concurrently, so chain them to keep show/hide in call order
// and stop two show calls from both creating the webview. The chain lives at
// module scope so it stays ordered across unmount and remount.
let pending: Promise<unknown> = Promise.resolve();

/** Clears the Academy session after all previously queued view work has settled. */
export function signOutAcademySession(): Promise<void> {
  const operation = pending.then(() => invoke("sign_out"));
  pending = operation.catch(() => undefined);
  return operation.then(() => undefined);
}

function enqueue(
  command: string,
  args?: {
    bounds: Bounds;
    url?: string;
    session?: WebViewSession;
    authCheck?: boolean;
  },
  onError?: (error: unknown) => void,
  onSuccess?: () => void,
) {
  pending = pending
    .then(() => invoke(command, args))
    .then(() => onSuccess?.())
    .catch((error) => {
      console.error(`${command} failed`, error);
      onError?.(error);
    });
}

type WebViewManagerOptions = {
  active: boolean;
  /** The latest page asked for, e.g. a course opened from the Dashboard. */
  request: WebViewRequest | null;
  sidebarTooltipOpen?: boolean;
  authCheck?: boolean;
};

/**
 * Lays the native child webview over `containerRef` while `active`, keeps its
 * bounds in sync, and reports failed opens so they can be retried.
 */
export function useWebViewManager({
  active,
  request,
  sidebarTooltipOpen = false,
  authCheck = false,
}: WebViewManagerOptions) {
  const desktop = isTauri();
  const containerRef = useRef<HTMLDivElement>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  // Read when the web view is shown so opening a course doesn't create it twice.
  const requestRef = useRef(request);
  requestRef.current = request;
  const sidebarTooltipOpenRef = useRef(sidebarTooltipOpen);
  sidebarTooltipOpenRef.current = sidebarTooltipOpen;
  const authCheckRef = useRef(authCheck);
  authCheckRef.current = authCheck;
  // Set once a show succeeds: only that page can be resumed without its URL.
  const loadedRequestId = useRef<number | null>(null);
  // Set while a show is queued or live, so the same request isn't shown twice.
  const scheduledRequestId = useRef<number | null>(null);
  const mountGeneration = useRef(0);
  // Bumped whenever a show is superseded, so its late result is ignored.
  const openGeneration = useRef(0);

  const show = useCallback(
    (container: HTMLElement, target: WebViewRequest | null) => {
      const generation = ++openGeneration.current;
      const alreadyLoaded =
        target !== null && target.id === loadedRequestId.current;
      // Pending requests prevent duplicate effects, but are not safe to resume yet.
      scheduledRequestId.current = target?.id ?? null;
      if (!alreadyLoaded) loadedRequestId.current = null;
      setOpenFailed(false);
      setErrorDialogOpen(false);
      const bounds = boundsOf(container, sidebarTooltipOpenRef.current);
      enqueue(
        "show_web_view",
        alreadyLoaded
          ? { bounds, authCheck: authCheckRef.current }
          : {
              bounds,
              url: target?.url,
              session: target?.session,
              authCheck: authCheckRef.current,
            },
        () => {
          if (generation !== openGeneration.current) return;
          loadedRequestId.current = null;
          scheduledRequestId.current = null;
          // A partially opened native view would otherwise cover the error message.
          enqueue("hide_web_view");
          setOpenFailed(true);
          setErrorDialogOpen(true);
        },
        () => {
          if (generation === openGeneration.current) {
            loadedRequestId.current = target?.id ?? null;
          }
        },
      );
      return generation;
    },
    [],
  );

  // Outside the desktop app the web view can never open, so explain why.
  useEffect(() => {
    if (active && !desktop) setErrorDialogOpen(true);
  }, [active, desktop]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container || !isTauri()) return;

    const sync = () =>
      enqueue("set_web_view_bounds", {
        bounds: boundsOf(container, sidebarTooltipOpenRef.current),
      });

    show(container, requestRef.current);

    // Covers sidebar collapse as well as window resizes.
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    window.addEventListener("resize", sync);

    return () => {
      ++openGeneration.current;
      scheduledRequestId.current = null;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      enqueue("hide_web_view");
    };
  }, [active, retryAttempt, show]);

  useEffect(() => {
    const generation = ++mountGeneration.current;
    return () => {
      // Strict Mode probes effects with a setup/cleanup/setup cycle. Deferring
      // lets the replacement setup cancel that probe without masking a real
      // component unmount.
      queueMicrotask(() => {
        if (mountGeneration.current === generation && isTauri()) {
          enqueue("dispose_web_view");
        }
      });
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container || !isTauri()) return;
    enqueue("set_web_view_bounds", {
      bounds: boundsOf(container, sidebarTooltipOpen),
    });
  }, [active, sidebarTooltipOpen]);

  // A page requested while the web view is already showing.
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !request || !container || !isTauri()) return;
    if (request.id === scheduledRequestId.current) return;
    const generation = show(container, request);
    return () => {
      if (generation === openGeneration.current) {
        ++openGeneration.current;
        scheduledRequestId.current = null;
      }
    };
  }, [active, request, show]);

  const retry = useCallback(() => setRetryAttempt((attempt) => attempt + 1), []);

  return {
    containerRef,
    /** The latest open failed; cleared when the next open starts. */
    openFailed,
    errorDialogOpen,
    setErrorDialogOpen,
    retry,
  };
}
