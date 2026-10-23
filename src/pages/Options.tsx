import { useState } from "react";
import { AppAlertDialog } from "@/components/app-alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import type { CourseOpenMode } from "@/lib/course";
import {
  SHORTCUT_MODIFIER_LABELS,
  type ShortcutModifier,
} from "@/lib/shortcuts";
import { applyTheme, saveTheme, type Theme } from "@/lib/theme";

type OptionsProps = {
  name: string;
  onNameChange: (name: string) => void;
  academyMember: boolean;
  onAcademyMemberChange: (academyMember: boolean) => void;
  courseOpenMode: CourseOpenMode;
  onCourseOpenModeChange: (courseOpenMode: CourseOpenMode) => void;
  shortcutModifier: ShortcutModifier;
  onShortcutModifierChange: (shortcutModifier: ShortcutModifier) => void;
  animations: boolean;
  onAnimationsChange: (animations: boolean) => void;
  onSignOut?: () => Promise<void>;
};

export default function Options({
  name,
  onNameChange,
  academyMember,
  onAcademyMemberChange,
  courseOpenMode,
  onCourseOpenModeChange,
  shortcutModifier,
  onShortcutModifierChange,
  animations,
  onAnimationsChange,
  onSignOut,
}: OptionsProps) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  function handleThemeChange(checked: boolean) {
    const next: Theme = checked ? "dark" : "light";
    setTheme(next);
    void applyTheme(next, true);
    saveTheme(next).catch((error) =>
      console.error("Could not save theme", error),
    );
  }

  async function handleSignOut() {
    if (!onSignOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      await onSignOut();
    } catch (error) {
      console.error("Could not sign out of ZTM Academy", error);
      setSignOutError(true);
      setSigningOut(false);
    }
  }

  return (
    <section className="flex max-w-xl flex-col gap-6 p-6">
      <h1 className="text-[1.75rem] font-semibold">Options</h1>
      <Field>
        <FieldLabel htmlFor="user-name">Name</FieldLabel>
        <Input
          id="user-name"
          value={name}
          maxLength={50}
          autoComplete="off"
          spellCheck={false}
          placeholder="Your name"
          onChange={(event) => onNameChange(event.target.value)}
        />
        <FieldDescription>Used to greet you on the Dashboard.</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="academy-member">Academy member</FieldLabel>
          <FieldDescription>
            Whether you have a Zero To Mastery Academy membership.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="academy-member"
          checked={academyMember}
          onCheckedChange={onAcademyMemberChange}
        />
      </Field>
      <FieldSet>
        <FieldLegend variant="label">Open courses in</FieldLegend>
        <RadioGroup
          value={courseOpenMode}
          onValueChange={(value) =>
            onCourseOpenModeChange(value as CourseOpenMode)
          }
        >
          <Field orientation="horizontal">
            <RadioGroupItem value="embedded" id="open-embedded" />
            <FieldContent>
              <FieldLabel htmlFor="open-embedded">The app (default)</FieldLabel>
              <FieldDescription>
                Courses load in the Web View, next to the app's sidebar. Linux
                opens courses in a separate window.
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem value="window" id="open-window" />
            <FieldContent>
              <FieldLabel htmlFor="open-window">A separate window</FieldLabel>
              <FieldDescription>
                Courses open in their own window you can move or resize.
              </FieldDescription>
            </FieldContent>
          </Field>
        </RadioGroup>
      </FieldSet>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="dark-mode">Dark mode</FieldLabel>
          <FieldDescription>
            Switch between light and dark colour schemes.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="dark-mode"
          checked={theme === "dark"}
          onCheckedChange={handleThemeChange}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="animations">Animations</FieldLabel>
          <FieldDescription>
            Play subtle motion effects, such as zooming course cards on hover.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="animations"
          checked={animations}
          onCheckedChange={onAnimationsChange}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="shortcut-modifier">Shortcut key</FieldLabel>
          <FieldDescription>
            Hold to show shortcuts, then press 1–5 to jump to a menu item or S
            to filter courses.
          </FieldDescription>
        </FieldContent>
        <NativeSelect
          id="shortcut-modifier"
          value={shortcutModifier}
          onChange={(event) =>
            onShortcutModifierChange(event.target.value as ShortcutModifier)
          }
        >
          {Object.entries(SHORTCUT_MODIFIER_LABELS).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {onSignOut && (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Academy account</FieldLabel>
            <FieldDescription>
              Clear your Academy session and return to the sign-in screen.
            </FieldDescription>
          </FieldContent>
          <Button
            variant="destructive"
            disabled={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </Field>
      )}
      <AppAlertDialog
        open={signOutError}
        onOpenChange={setSignOutError}
        title="Could not sign out"
        description="Your Academy session could not be cleared. Please try again."
        action={{ label: "Try again", onClick: handleSignOut }}
      />
    </section>
  );
}
