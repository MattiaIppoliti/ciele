/**
 * Local providers — this package's third public interface.
 *
 * A "local subscription" runs inference through a provider CLI the operator has
 * already authenticated on the machine (ADR-0015), rather than through an API
 * key. That makes it a provider-plumbing capability of the agent runtime, but a
 * distinct one from answering a turn: its consumers are the admin Settings
 * surface, the connect flow, and the relay routes — none of which touch the
 * chat runtime.
 *
 * It gets its own barrel so the server interface in `index.ts` stays about
 * answering messages. Same rules as the other two: adding an export here is a
 * deliberate act, and `interface.test.ts` locks the shape.
 *
 * **This barrel is server-only, unlike `./client`.** Its functions reach
 * `node:child_process`. Two client components legitimately need the *types* below
 * (`LocalSubscriptionProvider`, `LocalSubscriptionStatus`) — they must import them
 * with `import type`, which erases, so no server code enters the browser bundle.
 * A value import from a client component would pull the CLI layer in; if that
 * need ever appears, move the shape to `./client` rather than widening this.
 */

// Which providers exist, whether a local connection is permitted in this
// environment, and the loopback guard the connect flow enforces.
export {
  LOCAL_SUBSCRIPTION_PROVIDERS,
  isLocalSubscriptionProvider,
  isLocalSubscriptionTestEnabled,
  isLoopbackHost,
} from "./local-subscriptions";
export type {
  LocalSubscriptionProvider,
  LocalSubscriptionStatus,
} from "./local-subscriptions";

// Connection lifecycle: read status, start/cancel an interactive CLI login,
// disconnect. Drives Settings → AI and the subscription-connect page.
export {
  cancelLocalSubscriptionLogin,
  connectedLocalSubscriptionProviders,
  disconnectLocalSubscription,
  getLocalSubscriptionStatus,
  listLocalSubscriptionStatuses,
  startLocalSubscriptionLogin,
} from "./local-subscriptions";

// The CLI-backed language model: build a runner, ask which providers are
// verified ready, and drop a cached readiness probe after a connection changes.
export {
  clearLocalSubscriptionReadinessProbe,
  createLocalCliRunner,
  verifiedLocalSubscriptionProviders,
} from "./local-subscription-model";
// The runner's call/result shapes: the relay in apps/web implements this same
// contract over a paired device instead of a local CLI.
export type {
  LocalCliRunner,
  LocalCliInvocation,
  LocalCliResult,
} from "./local-subscription-model";
