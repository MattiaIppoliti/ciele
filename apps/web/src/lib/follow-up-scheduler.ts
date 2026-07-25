import type { ConnectorFollowUpBehavior } from "./local-connector-protocol";

export interface FollowUpState {
  active: boolean;
  queued: string[];
}

export type FollowUpCommand =
  | { type: "start"; message: string }
  | { type: "abort" };

export interface FollowUpTransition {
  state: FollowUpState;
  commands: FollowUpCommand[];
}

export function initialFollowUpState(): FollowUpState {
  return { active: false, queued: [] };
}

export function submitFollowUp(
  state: FollowUpState,
  message: string,
  behavior: ConnectorFollowUpBehavior
): FollowUpTransition {
  if (!state.active) {
    return {
      state: { active: true, queued: [] },
      commands: [{ type: "start", message }],
    };
  }
  if (behavior === "steer") {
    return {
      state: { active: true, queued: [message] },
      commands: [{ type: "abort" }],
    };
  }
  return {
    state: { active: true, queued: [...state.queued, message] },
    commands: [],
  };
}

export function completeFollowUp(state: FollowUpState): FollowUpTransition {
  const [message, ...queued] = state.queued;
  if (!message) {
    return { state: { active: false, queued: [] }, commands: [] };
  }
  return {
    state: { active: true, queued },
    commands: [{ type: "start", message }],
  };
}
