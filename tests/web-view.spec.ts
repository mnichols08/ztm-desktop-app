import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ACADEMY_AUTHENTICATED_EVENT,
  WEB_VIEW_DEMOTED_EVENT,
  WEB_VIEW_PROMOTED_EVENT,
} from "../src/lib/web-view-events";

type InvokeCall = { command: string; args: Record<string, unknown> };

async function authenticateAcademy(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (eventName) =>
          (
            globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
          ).__TAURI_CALLS__.some(
            (call) =>
              call.command === "plugin:event|listen" &&
              call.args.event === eventName,
          ),
        ACADEMY_AUTHENTICATED_EVENT,
      ),
    )
    .toBe(true);
  await page.evaluate(
    (eventName) =>
      (
        globalThis as typeof globalThis & {
          __emitTauriEvent: (event: string) => void;
        }
      ).__emitTauriEvent(eventName),
    ACADEMY_AUTHENTICATED_EVENT,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (payload: unknown) => void>();
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const calls: InvokeCall[] = [];
    const rejectedCommands = new Map<string, number>();
    const delayedCommands = new Map<string, () => Promise<never>>();
    const delayedRejections = new Map<string, () => void>();
    let callbackId = 0;

    Object.assign(globalThis, {
      isTauri: true,
      __TAURI_CALLS__: calls,
      __rejectTauriCommand(command: string, count = 1) {
        rejectedCommands.set(command, count);
      },
      __delayTauriRejection(command: string) {
        delayedCommands.set(command, () => new Promise<never>((_, reject) => {
          delayedRejections.set(command, () => reject(
            new Error(`${command} delayed rejection for test`),
          ));
        }));
      },
      __releaseTauriRejection(command: string) {
        const reject = delayedRejections.get(command);
        if (!reject) throw new Error(`No delayed ${command} to reject`);
        delayedRejections.delete(command);
        reject();
      },
      __emitTauriEvent(event: string, payload: unknown = null) {
        eventHandlers.get(event)?.({ event, id: 1, payload });
      },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (payload: unknown) => void) {
          callbackId += 1;
          callbacks.set(callbackId, callback);
          return callbackId;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args: Record<string, unknown> = {}) {
          calls.push({ command, args });
          const delayed = delayedCommands.get(command);
          if (delayed) {
            delayedCommands.delete(command);
            return delayed();
          }
          const rejections = rejectedCommands.get(command) ?? 0;
          if (rejections > 0) {
            rejectedCommands.set(command, rejections - 1);
            throw new Error(`${command} rejected for test`);
          }
          if (command === "load_state") return {};
          if (command === "load_courses") {
            return [
              {
                uuid: "test-course",
                name: "Test Course",
                imageUrl: null,
                enrolledUrl:
                  "https://academy.zerotomastery.io/courses/enrolled/test-course",
                publicUrl:
                  "https://academy.zerotomastery.io/p/test-course",
              },
              {
                uuid: "coming-soon-course",
                name: "Coming Soon Course",
                imageUrl: null,
                enrolledUrl: null,
                publicUrl: null,
              },
              {
                uuid: "second-course",
                name: "Second Course",
                imageUrl: null,
                enrolledUrl:
                  "https://academy.zerotomastery.io/courses/enrolled/second-course",
                publicUrl:
                  "https://academy.zerotomastery.io/p/second-course",
              },
            ];
          }
          if (command === "sync_courses") return null;
          if (command === "plugin:event|listen") {
            const handler = callbacks.get(args.handler as number);
            if (handler) eventHandlers.set(args.event as string, handler);
            return 1;
          }
          if (command === "plugin:event|unlisten") return null;
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener() {},
      },
    });
  });

  await page.goto("/");
  await authenticateAcademy(page);
});

for (const appFails of [false, true]) {
  test(`Discord ${appFails ? "falls back to the browser" : "opens the app"} without an error dialog`, async ({
    page,
  }) => {
    if (appFails) {
      await page.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            __rejectTauriCommand: (command: string) => void;
          }
        ).__rejectTauriCommand("plugin:opener|open_url"),
      );
    }

    await page.getByRole("button", { name: "Discord" }).click();
    const appUrl =
      "discord://-/channels/423464391791476747/423464391791476750";
    const browserUrl =
      "https://discord.com/channels/423464391791476747/423464391791476750";
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
          ).__TAURI_CALLS__
            .filter((call) => call.command === "plugin:opener|open_url")
            .map((call) => call.args.url),
        ),
      )
      .toEqual(appFails ? [appUrl, browserUrl] : [appUrl]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
}

for (const trigger of ["sidebar", "shortcut"]) {
  test(`Discord launch failure shows a dismissible error from the ${trigger}`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    if (trigger === "shortcut") {
      await page.getByRole("button", { name: "Web View", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
            ).__TAURI_CALLS__.at(-1)?.command,
          ),
        )
        .toBe("set_web_view_bounds");
    }
    await page.evaluate(() => {
      const mock = globalThis as typeof globalThis & {
        __TAURI_CALLS__: InvokeCall[];
        __rejectTauriCommand: (command: string, count: number) => void;
      };
      mock.__TAURI_CALLS__.length = 0;
      mock.__rejectTauriCommand("plugin:opener|open_url", 2);
    });

    if (trigger === "shortcut") {
      await page.keyboard.press("Alt+5");
    } else {
      await page.getByRole("button", { name: "Discord" }).click();
    }

    const dialog = page.getByRole("alertdialog", { name: "Could not open Discord" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Discord could not be opened in the app or your browser.",
    );
    if (trigger === "shortcut") {
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
            ).__TAURI_CALLS__.at(-1)?.command,
          ),
        )
        .toBe("hide_web_view");
    }
    await dialog.getByRole("button", { name: "Dismiss" }).click();
    await expect(dialog).toHaveCount(0);
    if (trigger === "shortcut") {
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
            ).__TAURI_CALLS__.some((call) => call.command === "show_web_view"),
          ),
        )
        .toBe(true);
    }
    expect(pageErrors).toEqual([]);
  });
}

test("the dashboard stays hidden until Academy authentication succeeds", async ({
  page,
}) => {
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Sign in to ZTM Academy" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Dashboard" })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.find(
          (call) =>
            call.command === "show_web_view" && call.args.authCheck === true,
        ),
      ),
    )
    .toBeTruthy();

  await page.evaluate(
    (eventName) =>
      (
        globalThis as typeof globalThis & {
          __emitTauriEvent: (event: string) => void;
        }
      ).__emitTauriEvent(eventName),
    ACADEMY_AUTHENTICATED_EVENT,
  );

  await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible();
});

test("signing out clears the Academy session and returns to the authentication gate", async ({
  page,
}) => {
  const authenticationShowsBefore = await page.evaluate(() =>
    (
      globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
    ).__TAURI_CALLS__.filter(
      (call) =>
        call.command === "show_web_view" && call.args.authCheck === true,
    ).length,
  );

  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.some((call) => call.command === "sign_out"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Sign in to ZTM Academy" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Dashboard" })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.filter(
          (call) =>
            call.command === "show_web_view" && call.args.authCheck === true,
        ).length,
      ),
    )
    .toBeGreaterThan(authenticationShowsBefore);
});

test("a failed sign-out keeps the app unlocked and offers a retry", async ({
  page,
}) => {
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __delayTauriRejection: (command: string) => void;
      }
    ).__delayTauriRejection("sign_out");
  });

  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect
    .poll(() =>
      page.locator('[data-slot="sidebar-wrapper"]').evaluate(
        (element) => (element as HTMLElement).inert,
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __releaseTauriRejection: (command: string) => void;
      }
    ).__releaseTauriRejection("sign_out"),
  );

  const dialog = page.getByRole("alertdialog", { name: "Could not sign out" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to ZTM Academy" }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('[data-slot="sidebar-wrapper"]').evaluate(
        (element) => (element as HTMLElement).inert,
      ),
    )
    .toBe(false);
});

test("the resolved system theme is synchronized to native Academy views", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveClass(/scheme-dark/);
  await expect(page.locator("html")).not.toHaveClass(/scheme-light/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__
          .filter((call) => call.command === "set_web_view_theme")
          .at(-1),
      ),
    )
    .toMatchObject({
      command: "set_web_view_theme",
      args: { theme: "dark", reset: false },
    });
});

test("changing theme in Options requests an Academy webview reset", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await authenticateAcademy(page);
  await expect(page.locator("html")).toHaveClass(/scheme-light/);
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("switch", { name: "Dark mode" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveClass(/scheme-dark/);
  await expect(page.locator("html")).not.toHaveClass(/scheme-light/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__
          .filter((call) => call.command === "set_web_view_theme")
          .at(-1),
      ),
    )
    .toMatchObject({
      command: "set_web_view_theme",
      args: { theme: "dark", reset: true },
    });
});

test("embedded webview bounds stay below the header and beside the sidebar", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Web View" }).click();
  await page
    .locator('[data-slot="sidebar-container"]')
    .evaluate(
      (element) =>
        new Promise<void>((resolve) => {
          const duration = Number.parseFloat(
            getComputedStyle(element).transitionDuration,
          );
          if (!duration) {
            resolve();
            return;
          }
          element.addEventListener("transitionend", () => resolve(), {
            once: true,
          });
          setTimeout(resolve, duration * 1_000 + 100);
        }),
    );
  const slot = page.getByTestId("web-view-slot");
  await expect(slot).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
          .__TAURI_CALLS__.find((call) => call.command === "show_web_view"),
      ),
    )
    .toBeTruthy();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const slot = document
          .querySelector('[data-testid="web-view-slot"]')!
          .getBoundingClientRect();
        const bounds = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.filter(
          (call) =>
            call.command === "show_web_view" ||
            call.command === "set_web_view_bounds",
        ).at(-1)?.args.bounds as
          | { x: number; y: number; width: number; height: number }
          | undefined;
        return Boolean(
          bounds &&
            bounds.x === slot.left &&
            bounds.y === slot.top &&
            bounds.width === slot.width &&
            bounds.height === slot.height,
        );
      }),
    )
    .toBe(true);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const value = document.querySelector(selector)!.getBoundingClientRect();
      return {
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        left: value.left,
        width: value.width,
        height: value.height,
      };
    };
    const calls = (
      globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
    ).__TAURI_CALLS__;
    const positioned = calls
      .filter(
        (call) =>
          call.command === "show_web_view" ||
          call.command === "set_web_view_bounds",
      )
      .at(-1)!;
    return {
      bounds: positioned.args.bounds as ReturnType<typeof rect>,
      slot: rect('[data-testid="web-view-slot"]'),
      sidebar: rect('[data-slot="sidebar-container"]'),
      header: rect("header"),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });

  expect(geometry.bounds).toEqual({
    x: geometry.slot.left,
    y: geometry.slot.top,
    width: geometry.slot.width,
    height: geometry.slot.height,
  });
  expect(geometry.slot.left).toBeGreaterThanOrEqual(geometry.sidebar.right);
  expect(geometry.slot.top).toBeGreaterThanOrEqual(geometry.header.bottom);
  expect(geometry.slot.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.slot.bottom).toBeLessThanOrEqual(geometry.viewport.height);
});

for (const hasCourses of [false, true]) {
  test(`Dashboard course failure uses a retryable dialog ${hasCourses ? "with" : "without"} saved courses`, async ({ page }) => {
    await page.addInitScript((keepCourses) => {
      const mock = globalThis as typeof globalThis & {
        __rejectTauriCommand: (command: string, count: number) => void;
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      };
      mock.__rejectTauriCommand("sync_courses", 2);
      if (!keepCourses) {
        const invoke = mock.__TAURI_INTERNALS__.invoke;
        mock.__TAURI_INTERNALS__.invoke = async (command, args) =>
          command === "load_courses" ? [] : invoke(command, args);
      }
    }, hasCourses);
    await page.reload();
    await authenticateAcademy(page);
    const dialog = page.getByRole("alertdialog", {
      name: hasCourses ? "Could not update courses" : "Could not load courses",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      hasCourses ? "Showing the saved local list" : "Check your internet connection",
    );
    await dialog.getByRole("button", { name: "Dismiss" }).click();
    await expect(dialog).toBeHidden();
    if (hasCourses) {
      await expect(page.getByRole("button", { name: "Test Course", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Course loading unavailable" }).click();
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Course loading unavailable" })).toHaveCount(0);
  });
}

test("opening localhost in a browser uses matching course and Web View dialogs", async ({ browser }) => {
  const preview = await browser.newPage();
  try {
    await preview.goto("http://localhost:1420/");
    const courseDialog = preview.getByRole("alertdialog", {
      name: "Course loading requires the desktop app",
    });
    await expect(courseDialog).toBeVisible();
    await expect(courseDialog).toContainText("Open the desktop app to continue.");
    await expect(courseDialog).toContainText("not the browser preview");
    await courseDialog.getByRole("button", { name: "Dismiss" }).click();
    await expect(courseDialog).toBeHidden();
    await preview.getByRole("button", { name: "Course loading unavailable" }).click();
    await expect(courseDialog).toBeVisible();
    await courseDialog.getByRole("button", { name: "Dismiss" }).click();
    await preview.getByRole("button", { name: "Web View", exact: true }).click();
    await expect(preview.getByRole("alertdialog", {
      name: "Web View requires the desktop app",
    })).toBeVisible();
    await expect(courseDialog).toHaveCount(0);
    await expect(preview.getByRole("alertdialog")).toHaveCount(1);
  } finally {
    await preview.close();
  }
});

test("browser preview explains Web View availability in a dismissible dialog", async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(globalThis, { isTauri: false });
  });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Web View", exact: true }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Web View requires the desktop app",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("not the browser preview");
  await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Web View unavailable" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await page.keyboard.press("Alt+1");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Alt+3");
  await expect(dialog).toBeVisible();
});

test("a failed webview open is reported in a dismissible dialog", async ({
  page,
}) => {
  await page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __rejectTauriCommand: (command: string) => void;
      }
    ).__rejectTauriCommand("show_web_view"),
  );

  await page.getByRole("button", { name: "Web View" }).click();

  await expect(
    page.getByRole("alertdialog", { name: "Could not open the Web View" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await page.getByRole("button", { name: "Web View unavailable" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("the Web View error clears after a successful retry", async ({ page }) => {
  await page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __rejectTauriCommand: (command: string) => void;
      }
    ).__rejectTauriCommand("show_web_view"),
  );
  await page.getByRole("button", { name: "Web View" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Could not open the Web View" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("alertdialog")).toBeHidden();
});

test("the Web View error dialog is described, takes focus, and returns it", async ({
  page,
}) => {
  await page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __rejectTauriCommand: (command: string) => void;
      }
    ).__rejectTauriCommand("show_web_view"),
  );
  await page.getByRole("button", { name: "Web View" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Could not open the Web View",
  });
  await expect(dialog).toHaveAccessibleDescription(
    "The Web View could not be opened. Please try again.",
  );
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const reopen = page.getByRole("button", { name: "Web View unavailable" });
  await reopen.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await expect(dialog).toBeHidden();
  await expect(reopen).toBeFocused();
});

test("a failed demoted session is retried with the same URL and session", async ({
  page,
}) => {
  const session = {
    url: "https://academy.zerotomastery.io/lessons/current-lesson",
    scrollX: 0,
    scrollY: 320,
    mediaTime: 42,
    mediaPaused: true,
    playbackRate: 1,
  };
  await page.evaluate(() => {
    const mock = globalThis as typeof globalThis & {
      __TAURI_CALLS__: InvokeCall[];
      __rejectTauriCommand: (command: string, count: number) => void;
    };
    mock.__TAURI_CALLS__.length = 0;
    mock.__rejectTauriCommand("show_web_view", 2);
  });
  await page.evaluate(
    ({ eventName, payload }) =>
      (
        globalThis as typeof globalThis & {
          __emitTauriEvent: (event: string, payload: unknown) => void;
        }
      ).__emitTauriEvent(eventName, payload),
    { eventName: WEB_VIEW_DEMOTED_EVENT, payload: session },
  );
  const dialog = page.getByRole("alertdialog", {
    name: "Could not open the Web View",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.filter((call) => call.command === "show_web_view")
        .map((call) => ({ url: call.args.url, session: call.args.session })),
    ),
  ).toEqual(Array(3).fill({ url: session.url, session }));
});

test("a failed course Web View is hidden and retries the same URL", async ({ page }) => {
  await page.evaluate(() => {
    const mock = globalThis as typeof globalThis & {
      __TAURI_CALLS__: InvokeCall[];
      __rejectTauriCommand: (command: string, count: number) => void;
    };
    mock.__TAURI_CALLS__.length = 0;
    mock.__rejectTauriCommand("show_web_view", 2);
  });
  await page.getByRole("button", { name: "Test Course", exact: true }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert).toContainText("Could not open the Web View");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.some((call) => call.command === "hide_web_view"),
      ),
    )
    .toBe(true);

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.filter((call) => call.command === "show_web_view").length,
      ),
    )
    .toBe(2);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__
          .filter((call) => call.command === "show_web_view")
          .map((call) => call.args.url),
      ),
    )
    .toEqual(Array(3).fill(
      "https://academy.zerotomastery.io/courses/enrolled/test-course",
    ));
});

test("a superseded delayed failure cannot hide a newer course or show an error", async ({ page }) => {
  await page.evaluate(() => {
    const mock = globalThis as typeof globalThis & {
      __TAURI_CALLS__: InvokeCall[];
      __delayTauriRejection: (command: string) => void;
    };
    mock.__TAURI_CALLS__.length = 0;
    mock.__delayTauriRejection("show_web_view");
  });
  await page.getByRole("button", { name: "Test Course", exact: true }).click();
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.some((call) => call.command === "show_web_view"),
    ),
  ).toBe(true);

  await page.keyboard.press("Alt+1");
  await page.getByRole("button", { name: "Second Course", exact: true }).click();
  await expect(page.getByTestId("web-view-slot")).toBeVisible();
  await page.evaluate(() =>
    (globalThis as typeof globalThis & {
      __releaseTauriRejection: (command: string) => void;
    }).__releaseTauriRejection("show_web_view"),
  );

  // A resize command is queued after B's show and any erroneous failure hide.
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.some((call) =>
          call.command === "set_web_view_bounds" &&
          (call.args.bounds as { width: number }).width === 1152,
        ),
    ),
  ).toBe(true);
  const commands = await page.evaluate(() =>
    (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
      .__TAURI_CALLS__.filter((call) =>
        call.command === "show_web_view" || call.command === "hide_web_view",
      ),
  );
  expect(commands.map((call) => call.command)).toEqual([
    "show_web_view", "hide_web_view", "show_web_view",
  ]);
  expect(commands.at(-1)?.args.url).toBe(
    "https://academy.zerotomastery.io/courses/enrolled/second-course",
  );
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Web View unavailable" })).toHaveCount(0);
});

for (const returnBeforeFailure of [false, true]) {
test(`returning ${returnBeforeFailure ? "before" : "after"} an inactive open failure retries the original course URL`, async ({ page }) => {
  const courseUrl = "https://academy.zerotomastery.io/courses/enrolled/test-course";
  await page.evaluate(() => {
    const mock = globalThis as typeof globalThis & {
      __TAURI_CALLS__: InvokeCall[];
      __delayTauriRejection: (command: string) => void;
    };
    mock.__TAURI_CALLS__.length = 0;
    mock.__delayTauriRejection("show_web_view");
  });
  await page.getByRole("button", { name: "Test Course", exact: true }).click();
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.some((call) => call.command === "show_web_view"),
    ),
  ).toBe(true);
  await page.keyboard.press("Alt+1");
  await expect(page.getByTestId("web-view-slot")).toBeHidden();
  if (returnBeforeFailure) {
    await page.keyboard.press("Alt+3");
    await expect(page.getByTestId("web-view-slot")).toBeVisible();
  }
  await page.evaluate(() =>
    (globalThis as typeof globalThis & {
      __releaseTauriRejection: (command: string) => void;
    }).__releaseTauriRejection("show_web_view"),
  );
  // The queued hide confirms the failed show has settled while inactive.
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.some((call) => call.command === "hide_web_view"),
    ),
  ).toBe(true);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  if (!returnBeforeFailure) await page.keyboard.press("Alt+3");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.filter((call) => call.command === "show_web_view")
        .map((call) => call.args.url),
    ),
  ).toEqual([courseUrl, courseUrl]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Web View unavailable" })).toHaveCount(0);

  await page.keyboard.press("Alt+1");
  await page.keyboard.press("Alt+3");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.filter((call) => call.command === "show_web_view")
        .map((call) => call.args.url),
    ),
  ).toEqual([courseUrl, courseUrl, undefined]);
});
}

test("entering Web View from the sidebar collapses the app sidebar", async ({
  page,
}) => {
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page.getByRole("button", { name: "Web View" }).click();

  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.getByTestId("web-view-slot")).toBeVisible();
});

test("opening a course in Web View collapses the app sidebar", async ({
  page,
}) => {
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page
    .getByRole("button", { name: "Test Course", exact: true })
    .click();

  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.getByTestId("web-view-slot")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.find(
          (call) =>
            call.command === "show_web_view" &&
            call.args.url ===
              "https://academy.zerotomastery.io/courses/enrolled/test-course",
        ),
      ),
    )
    .toBeTruthy();
});

test("a course without a URL has no open action but keeps its favourite action", async ({
  page,
}) => {
  const card = page.locator('[data-slot="card"]', {
    has: page.getByRole("heading", { name: "Coming Soon Course" }),
  });

  await expect(card.locator("[data-open-course]")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(card.getByText("Coming soon", { exact: true })).toBeVisible();

  const showCallsBefore = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.filter((call) => call.command === "show_web_view")
        .length,
  );
  await card.click();
  await expect(page.getByTestId("web-view-slot")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __TAURI_CALLS__: InvokeCall[];
            }
          ).__TAURI_CALLS__.filter(
            (call) => call.command === "show_web_view",
          ).length,
      ),
    )
    .toBe(showCallsBefore);

  await page
    .getByRole("button", { name: "Test Course", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    card.getByRole("button", {
      name: "Add Coming Soon Course to favourites",
    }),
  ).toBeFocused();
});

test("a course without a URL can be favourited and removed from Favourites", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Add Coming Soon Course to favourites" })
    .click();
  await page
    .getByRole("button", { name: "Favourites", exact: true })
    .click();

  await expect(
    page.getByRole("heading", { name: "Coming Soon Course" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove Coming Soon Course from favourites",
    })
    .click();

  await expect(
    page.getByText("No favourites yet. Star a course on the Dashboard to add it here."),
  ).toBeVisible();
});

test("collapsed sidebar tooltips temporarily clear the native webview", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Web View" }).click();

  const slot = page.getByTestId("web-view-slot");
  const dashboard = page.getByRole("button", { name: "Dashboard" });
  await expect(slot).toBeVisible();
  await dashboard.hover();

  const tooltip = page.locator('[data-slot="tooltip-content"]', {
    hasText: "Dashboard",
  });
  await expect(tooltip).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.filter(
          (call) => call.command === "set_web_view_bounds",
        );
        const bounds = calls.at(-1)?.args.bounds as
          | { x: number; width: number }
          | undefined;
        const slotRect = document
          .querySelector('[data-testid="web-view-slot"]')!
          .getBoundingClientRect();
        const tooltipRect = document
          .querySelector('[data-slot="tooltip-content"]')!
          .getBoundingClientRect();
        return {
          clearsTooltip: Boolean(bounds && bounds.x >= tooltipRect.right),
          shrinksFromLeft: Boolean(
            bounds &&
              bounds.x > slotRect.left &&
              bounds.width < slotRect.width,
          ),
        };
      }),
    )
    .toEqual({ clearsTooltip: true, shrinksFromLeft: true });

  await page.locator("header").hover();
  await expect(tooltip).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bounds = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.filter(
          (call) => call.command === "set_web_view_bounds",
        ).at(-1)?.args.bounds as { x: number; width: number } | undefined;
        const slotRect = document
          .querySelector('[data-testid="web-view-slot"]')!
          .getBoundingClientRect();
        return Boolean(
          bounds &&
            bounds.x === slotRect.left &&
            bounds.width === slotRect.width,
        );
      }),
    )
    .toBe(true);
});

test("switching views hides and resumes the live native child", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Test Course", exact: true })
    .click();
  await expect(page.getByTestId("web-view-slot")).toBeVisible();

  const callsBefore = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.length,
  );
  await page.getByRole("button", { name: "Dashboard" }).click();

  await expect(page.getByTestId("web-view-slot")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate((start) => {
        const calls = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.slice(start);
        return {
          hides: calls.filter((call) => call.command === "hide_web_view")
            .length,
          disposes: calls.filter(
            (call) => call.command === "dispose_web_view",
          ).length,
        };
      }, callsBefore),
    )
    .toEqual({ hides: 1, disposes: 0 });

  const callsBeforeReturn = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.length,
  );
  await page.getByRole("button", { name: "Web View" }).click();

  await expect
    .poll(() =>
      page.evaluate((start) => {
        const show = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.slice(start).find(
          (call) => call.command === "show_web_view",
        );
        return Boolean(
          show && !("url" in show.args) && !("session" in show.args),
        );
      }, callsBeforeReturn),
    )
    .toBe(true);
});

test("opening another course while hidden navigates to its URL", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Test Course", exact: true })
    .click();
  await page.getByRole("button", { name: "Dashboard" }).click();

  const callsBefore = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
        .__TAURI_CALLS__.length,
  );
  await page
    .getByRole("button", { name: "Second Course", exact: true })
    .click();

  await expect
    .poll(() =>
      page.evaluate((start) => {
        const show = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.slice(start).find(
          (call) => call.command === "show_web_view",
        );
        return show?.args.url;
      }, callsBefore),
    )
    .toBe(
      "https://academy.zerotomastery.io/courses/enrolled/second-course",
    );
});

test("only a real Web View unmount disposes its native child", async ({
  page,
}) => {
  const mountResult = await page.evaluate(async () => {
    const load = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<Record<string, unknown>>;
    const react = await load("/node_modules/.vite/deps/react.js");
    const reactDom = await load(
      "/node_modules/.vite/deps/react-dom_client.js",
    );
    const webViewModule = await load("/src/components/web-view.tsx");
    const createElement = (react.createElement ??
      (react.default as { createElement?: (...args: unknown[]) => unknown })
        ?.createElement) as (...args: unknown[]) => unknown;
    const StrictMode = (react.StrictMode ??
      (react.default as { StrictMode?: unknown })?.StrictMode) as unknown;
    const createRoot = (reactDom.createRoot ??
      (reactDom.default as {
        createRoot?: (element: Element) => {
          render(node: unknown): void;
          unmount(): void;
        };
      })?.createRoot) as (element: Element) => {
      render(node: unknown): void;
      unmount(): void;
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const callsAtMount = (
      globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
    ).__TAURI_CALLS__.length;
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(webViewModule.WebView, {
          active: false,
          request: null,
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const calls = (
      globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
    ).__TAURI_CALLS__;
    const callCount = calls.length;
    const disposesWhileMounted = calls
      .slice(callsAtMount)
      .filter((call) => call.command === "dispose_web_view").length;
    root.unmount();
    return { callCount, disposesWhileMounted };
  });

  expect(mountResult.disposesWhileMounted).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        (start) =>
          (
            globalThis as typeof globalThis & {
              __TAURI_CALLS__: InvokeCall[];
            }
          ).__TAURI_CALLS__.slice(start),
        mountResult.callCount,
      ),
    )
    .toContainEqual(expect.objectContaining({ command: "dispose_web_view" }));
});

test("promotion returns the shell to Dashboard and disposes its child", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Web View" }).click();
  await expect(page.getByTestId("web-view-slot")).toBeVisible();

  await page.evaluate(
    (eventName) =>
      (
        globalThis as typeof globalThis & {
          __emitTauriEvent: (event: string) => void;
        }
      ).__emitTauriEvent(eventName),
    WEB_VIEW_PROMOTED_EVENT,
  );

  await expect(
    page.getByRole("button", { name: "Dashboard" }),
  ).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] })
          .__TAURI_CALLS__.some(
            (call) => call.command === "dispose_web_view",
          ),
      ),
    )
    .toBe(true);
});

test("demotion recreates the embedded view with its current session", async ({
  page,
}) => {
  const session = {
    url: "https://academy.zerotomastery.io/lessons/current-lesson",
    scrollX: 20,
    scrollY: 640,
    mediaTime: 125.5,
    mediaPaused: false,
    playbackRate: 1.25,
  };

  await page.getByRole("button", { name: "Web View" }).click();
  await page.evaluate(
    (eventName) =>
      (
        globalThis as typeof globalThis & {
          __emitTauriEvent: (event: string) => void;
        }
      ).__emitTauriEvent(eventName),
    WEB_VIEW_PROMOTED_EVENT,
  );
  await page.evaluate(
    ({ eventName, payload }) =>
      (
        globalThis as typeof globalThis & {
          __emitTauriEvent: (event: string, payload: unknown) => void;
        }
      ).__emitTauriEvent(eventName, payload),
    {
      eventName: WEB_VIEW_DEMOTED_EVENT,
      payload: session,
    },
  );

  await expect(page.getByTestId("web-view-slot")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((expected) => {
        const calls = (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.filter((call) => call.command === "show_web_view");
        const last = calls.at(-1);
        return (
          last?.args.url === expected.url &&
          JSON.stringify(last?.args.session) === JSON.stringify(expected)
        );
      }, session),
    )
    .toBe(true);
});

test("opening a course shows it under Resume on the Dashboard", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { name: "Resume" })).toHaveCount(0);

  await page.getByRole("button", { name: "Second Course", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { __TAURI_CALLS__: InvokeCall[] }
        ).__TAURI_CALLS__.some(
          (call) =>
            call.command === "save_state" &&
            (call.args.state as { lastCourse?: string }).lastCourse ===
              "second-course",
        ),
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Dashboard" }).click();
  const resume = page.getByRole("list", { name: "Resume" });
  await expect(resume.getByRole("listitem")).toHaveCount(1);
  await expect(
    resume.getByRole("button", { name: "Second Course", exact: true }),
  ).toBeVisible();
});

test("the animations option applies to the Resume and Courses grids", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Second Course", exact: true }).click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  const grids = [
    page.getByRole("list", { name: "Resume" }),
    page.getByRole("list", { name: "Courses" }),
  ];
  const hoveredScale = async (grid: (typeof grids)[number]) => {
    const card = grid.locator('[data-slot="card"]', {
      has: page.getByRole("heading", { name: "Second Course" }),
    });
    await card.getByRole("button", { name: "Second Course", exact: true }).hover();
    return card.evaluate((element) => getComputedStyle(element).scale);
  };

  for (const grid of grids) {
    await expect.poll(() => hoveredScale(grid)).toBe("1.02");
  }

  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("switch", { name: "Animations" }).click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  for (const grid of grids) {
    await expect.poll(() => hoveredScale(grid)).toBe("none");
  }
});
