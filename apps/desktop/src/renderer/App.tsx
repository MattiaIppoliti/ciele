import type { ReactNode } from "react";
import { useAppState, useRoute } from "./lib/bridge";
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
  );
}
