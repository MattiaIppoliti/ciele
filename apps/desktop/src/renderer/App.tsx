import type { ReactNode } from "react";
import { FeedbackProvider } from "@agent-hub/ui/feedback";
import { bridge, useAppState, useRoute } from "./lib/bridge";
import { UpdateBanner } from "./components/update-banner";
import { WelcomeScreen } from "./screens/welcome";
import { SettingsScreen } from "./screens/settings";
import { WizardScreen } from "./screens/wizard";
import { StackScreen } from "./screens/stack";
import { UnreachableScreen } from "./screens/unreachable";

export function App(): ReactNode {
  const state = useAppState();
  const route = useRoute();

  // One paint of empty canvas while the first state arrives, rather than a
  // spinner that would be gone before it finished animating.
  if (!state) return <div className="h-full bg-canvas" data-testid="loading" />;

  return (
    // The same interface sounds as the console (#817), from the same module.
    // Mute is controlled from the main process's settings rather than this
    // origin's storage, so one switch covers the native screens and, through
    // the product window's own console, the whole machine's Ciele.
    <FeedbackProvider
      muted={state.settings.soundsMuted}
      onMutedChange={(muted) => void bridge().setSoundsMuted(muted)}
    >
      <div className="flex h-full flex-col bg-canvas" data-route={route}>
        {state.update ? <UpdateBanner update={state.update} /> : null}
        <div className="min-h-0 flex-1">
          {route === "/unreachable" ? (
            <UnreachableScreen state={state} />
          ) : route === "/settings" ? (
            <SettingsScreen state={state} />
          ) : route === "/stack" ? (
            <StackScreen />
          ) : route === "/setup" ? (
            <WizardScreen />
          ) : (
            <WelcomeScreen state={state} />
          )}
        </div>
      </div>
    </FeedbackProvider>
  );
}
