import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SearchIcon } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Favourites from "./pages/Favourites";
import Options from "./pages/Options";
import { AppAlertDialog } from "@/components/app-alert-dialog";
import { AppSidebar } from "@/components/app-sidebar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { WebView } from "@/components/web-view";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAcademyMember } from "@/hooks/use-academy-member";
import { useAnimations } from "@/hooks/use-animations";
import { useCourseOpenMode } from "@/hooks/use-course-open-mode";
import { useCourses } from "@/hooks/use-courses";
import { useFavourites } from "@/hooks/use-favourites";
import { useLastCourse } from "@/hooks/use-last-course";
import { useShortcutModifier } from "@/hooks/use-shortcut-modifier";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useUserName } from "@/hooks/use-user-name";
import {
  signOutAcademySession,
  type WebViewRequest,
  type WebViewSession,
} from "@/hooks/use-web-view-manager";
import { courseUrl, type Course } from "@/lib/course";
import { openDiscord } from "@/lib/discord";
import type { View } from "@/lib/view";
import {
  ACADEMY_AUTHENTICATED_EVENT,
  WEB_VIEW_DEMOTED_EVENT,
  WEB_VIEW_PROMOTED_EVENT,
} from "@/lib/web-view-events";

function App() {
  const desktop = isTauri();
  const [query, setQuery] = useState("");
  const [academyAuthenticated, setAcademyAuthenticated] = useState(!desktop);
  const [authenticationReady, setAuthenticationReady] = useState(!desktop);
  const [view, setView] = useState<View>(
    desktop ? "web-view" : "dashboard",
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [discordOpenError, setDiscordOpenError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { courses, syncing, error, retry } = useCourses();
  const { favourites, toggleFavourite } = useFavourites();
  const { lastCourse, setLastCourse } = useLastCourse();
  const { name, setName } = useUserName();
  const { academyMember, setAcademyMember } = useAcademyMember();
  const { courseOpenMode, setCourseOpenMode } = useCourseOpenMode();
  const { animations, setAnimations } = useAnimations();
  const { shortcutModifier, setShortcutModifier } = useShortcutModifier();
  const filterRef = useRef<HTMLInputElement>(null);
  const hasFilter = view === "dashboard" || view === "favourites";
  const [webViewRequest, setWebViewRequest] = useState<WebViewRequest | null>(
    null,
  );
  const [activeSidebarTooltip, setActiveSidebarTooltip] = useState<
    string | null
  >(null);
  const handleSidebarTooltipOpenChange = useCallback(
    (tooltip: string, open: boolean) => {
      setActiveSidebarTooltip((active) => {
        if (open) return tooltip;
        return active === tooltip ? null : active;
      });
    },
    [],
  );
  const selectView = useCallback((nextView: View) => {
    if (nextView === "web-view") setSidebarOpen(false);
    setView(nextView);
  }, []);

  function focusFilter() {
    if (!hasFilter) selectView("dashboard");
    // The filter only mounts once the view has a filter, so wait for that render.
    requestAnimationFrame(() => filterRef.current?.focus());
  }

  async function handleOpenDiscord() {
    try {
      await openDiscord();
    } catch (error) {
      console.error("Could not open Discord in the app or browser", error);
      setDiscordOpenError(true);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutAcademySession();
    } catch (error) {
      setSigningOut(false);
      throw error;
    }
    setWebViewRequest(null);
    setActiveSidebarTooltip(null);
    setAcademyAuthenticated(false);
    setAuthenticationReady(true);
    setSigningOut(false);
    setSidebarOpen(false);
    setView("web-view");
  }

  // Shortcuts stay off on the sign-in screen, where there is no sidebar to jump around.
  const showHints = useShortcuts(
    shortcutModifier,
    academyAuthenticated && !signingOut
      ? {
          Digit1: () => selectView("dashboard"),
          Digit2: () => selectView("favourites"),
          Digit3: () => selectView("web-view"),
          Digit4: () => selectView("options"),
          Digit5: handleOpenDiscord,
          KeyS: focusFilter,
        }
      : {},
  );

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    const promoted = listen(WEB_VIEW_PROMOTED_EVENT, () =>
      selectView("dashboard"),
    );
    const demoted = listen<WebViewSession>(WEB_VIEW_DEMOTED_EVENT, (event) => {
      setWebViewRequest((previous) => ({
        url: event.payload.url,
        id: (previous?.id ?? 0) + 1,
        session: event.payload,
      }));
      selectView("web-view");
    });
    const authenticated = listen(ACADEMY_AUTHENTICATED_EVENT, () => {
      setAcademyAuthenticated(true);
      setSidebarOpen(true);
      setView("dashboard");
    });
    Promise.all([promoted, demoted, authenticated]).then(() => {
      if (!cancelled) setAuthenticationReady(true);
    });
    return () => {
      cancelled = true;
      promoted.then((stop) => stop());
      demoted.then((stop) => stop());
      authenticated.then((stop) => stop());
    };
  }, [desktop, selectView]);

  const canOpenCourse = useCallback(
    (course: Course) => courseUrl(course, academyMember) !== null,
    [academyMember],
  );

  const openCourse = useCallback(
    (course: Course) => {
      const url = courseUrl(course, academyMember);
      if (!url) return;
      setLastCourse(course.uuid);
      const openEmbedded = () => {
        setWebViewRequest((previous) => ({ url, id: (previous?.id ?? 0) + 1 }));
        selectView("web-view");
      };
      if (courseOpenMode === "window" && isTauri()) {
        // If the window can't open, show the course in the app rather than nowhere.
        invoke("open_course_window", { url }).catch((error) => {
          console.error("Could not open course window", error);
          openEmbedded();
        });
        return;
      }
      openEmbedded();
    },
    [academyMember, courseOpenMode, selectView, setLastCourse],
  );

  if (!academyAuthenticated) {
    return (
      <main className="min-h-svh bg-background text-foreground">
        <header className="flex h-14 items-center border-b px-4">
          <h1 className="text-sm font-medium">Sign in to ZTM Academy</h1>
        </header>
        {authenticationReady ? (
          <WebView active request={null} authCheck />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Checking your Academy session…
          </p>
        )}
      </main>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        inert={signingOut || undefined}
      >
        <AppSidebar
          view={view}
          onViewChange={selectView}
          onOpenDiscord={handleOpenDiscord}
          onTooltipOpenChange={handleSidebarTooltipOpenChange}
          showHints={showHints}
        />
        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center border-b px-4">
            <SidebarTrigger />
            {hasFilter && (
              <InputGroup className="ml-2 h-10">
                <InputGroupInput
                  ref={filterRef}
                  type="search"
                  aria-label="Filter courses"
                  placeholder="Filter courses..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                {showHints && (
                  <InputGroupAddon align="inline-end">
                    <Kbd className="border bg-background text-foreground">S</Kbd>
                  </InputGroupAddon>
                )}
              </InputGroup>
            )}
          </header>
          <div id="dashboard" hidden={view !== "dashboard"}>
            <Dashboard
              active={view === "dashboard" && !discordOpenError}
              name={name}
              academyMember={academyMember}
              filter={query}
              courses={courses}
              lastCourse={lastCourse}
              syncing={syncing}
              error={error}
              onRetry={retry}
              favourites={favourites}
              onToggleFavourite={toggleFavourite}
              onOpenCourse={openCourse}
              canOpenCourse={canOpenCourse}
              animations={animations}
            />
          </div>
          <div id="favourites" hidden={view !== "favourites"}>
            <Favourites
              filter={query}
              courses={courses}
              favourites={favourites}
              onToggleFavourite={toggleFavourite}
              onOpenCourse={openCourse}
              canOpenCourse={canOpenCourse}
              animations={animations}
            />
          </div>
          <div id="web-view" hidden={view !== "web-view"}>
            <WebView
              active={view === "web-view" && !discordOpenError}
              request={webViewRequest}
              sidebarTooltipOpen={activeSidebarTooltip !== null}
            />
          </div>
          <div id="options" hidden={view !== "options"}>
            <Options
              name={name}
              onNameChange={setName}
              academyMember={academyMember}
              onAcademyMemberChange={setAcademyMember}
              courseOpenMode={courseOpenMode}
              onCourseOpenModeChange={setCourseOpenMode}
              shortcutModifier={shortcutModifier}
              onShortcutModifierChange={setShortcutModifier}
              animations={animations}
              onAnimationsChange={setAnimations}
              onSignOut={desktop ? handleSignOut : undefined}
            />
          </div>
        </div>
      </SidebarProvider>
      <AppAlertDialog
        open={discordOpenError}
        onOpenChange={setDiscordOpenError}
        title="Could not open Discord"
        description="Discord could not be opened in the app or your browser. Check that Discord or a default browser is installed, then try again."
      />
    </TooltipProvider>
  );
}

export default App;
