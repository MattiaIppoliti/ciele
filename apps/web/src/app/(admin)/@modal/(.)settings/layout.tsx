import SettingsLayout from "../../settings/layout";
import { ModalRouteGate } from "@/components/shell/modal-route-gate";

/**
 * Settings opened from inside the console, intercepted into the `@modal`
 * slot so the page underneath stays: Settings from the Chat opens over the
 * Chat, and closing it (`router.back()`) returns there. A direct visit or a
 * reload of `/settings/*` is not intercepted and renders the ordinary route,
 * the same dialog over its own page, as before.
 *
 * Every page and loading boundary below re-exports the real one, so there is
 * one Settings and this is only a second way in.
 */
export default function InterceptedSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModalRouteGate prefix="/settings">
      <SettingsLayout>{children}</SettingsLayout>
    </ModalRouteGate>
  );
}
