import type { EscalationChannel, EscalationHelpDesk } from "./escalation-desks";
import { initialEscalationDesk } from "./escalation-desks";

/**
 * The escalation surface's four-screen navigation (desk list → a desk's
 * channels → a channel's form → confirmation), shared by the published widget
 * and the editor Preview.
 *
 * The whole stack is ONE value, and every move is a pure transition over it,
 * so neither component re-derives "where am I" from a handful of independent
 * useStates and neither owns a copy of the Back cascade. Both keep their own
 * fetching and form-field state and reduce over this; a change to how Back
 * walks the stack lands on both surfaces at once.
 *
 * The confirmation payload differs by surface (the widget shows a mailto
 * link with its message, the Preview only the message), so it rides as a type
 * parameter, the navigation itself never reads it beyond present-or-absent.
 */
export interface EscalationNav<TConfirmation> {
  /** null while the desk list is still loading. */
  desks: EscalationHelpDesk[] | null;
  activeDesk: EscalationHelpDesk | null;
  activeChannel: EscalationChannel | null;
  confirmation: TConfirmation | null;
}

/**
 * Where both surfaces start: desks on the way, nothing entered. One shared
 * value, so it is frozen, every transition below returns a new object and an
 * in-place tweak here would poison both surfaces at once.
 */
export const loadingEscalationNav: Readonly<EscalationNav<never>> =
  Object.freeze({
    desks: null,
    activeDesk: null,
    activeChannel: null,
    confirmation: null,
  });

/**
 * The desk list arrived. A single desk (or the one the caller named) is
 * entered immediately, nobody wants a one-item menu. A failed load calls this
 * with `[]`: an empty list is an honest "no channels available" screen, while
 * leaving `desks` null would spin forever.
 */
export function escalationLoaded<C>(
  nav: EscalationNav<C>,
  desks: EscalationHelpDesk[],
  helpDeskId?: string
): EscalationNav<C> {
  return {
    ...nav,
    desks,
    activeDesk: initialEscalationDesk(desks, helpDeskId),
  };
}

export function escalationOpenDesk<C>(
  nav: EscalationNav<C>,
  desk: EscalationHelpDesk
): EscalationNav<C> {
  return { ...nav, activeDesk: desk };
}

export function escalationOpenChannel<C>(
  nav: EscalationNav<C>,
  channel: EscalationChannel
): EscalationNav<C> {
  return { ...nav, activeChannel: channel };
}

export function escalationConfirmed<C>(
  nav: EscalationNav<C>,
  confirmation: C
): EscalationNav<C> {
  return { ...nav, confirmation };
}

export type EscalationScreen =
  | "loading"
  | "empty"
  | "confirmation"
  | "form"
  | "channels"
  | "desks";

/**
 * Which screen the state renders.
 *
 * Two orderings here are deliberate judgments rather than lifts of the
 * pre-refactor conditions, both on states that are unreachable today:
 *
 * - A confirmation outranks the loading spinner. The widget used to test the
 *   two independently and could in principle paint both; a submission's
 *   outcome should never be hidden behind a refetch.
 * - "channels" needs only an entered desk, where `escalationBack` additionally
 *   requires more than one desk. That is not a disagreement: this asks what
 *   the Visitor is looking at (a desk is open, so its channels), Back asks
 *   whether there is a list worth returning TO (a lone auto-entered desk is
 *   not). `escalationLoaded` enters a single desk on arrival, so the
 *   deskless-with-one-desk state never occurs either way.
 */
export function escalationScreen<C>(nav: EscalationNav<C>): EscalationScreen {
  if (nav.confirmation !== null) return "confirmation";
  if (nav.activeChannel !== null) return "form";
  if (nav.desks === null) return "loading";
  if (nav.activeDesk !== null) return "channels";
  if (nav.desks.length === 0) return "empty";
  return "desks";
}

/**
 * One press of Back: the state one screen up, or **null** when there is
 * nothing left to pop and the caller should close the escalation surface.
 *
 * Leaving the confirmation clears the submitted channel with it, so Back
 * lands on the desk's channel list rather than re-opening the form that was
 * just sent. A single desk was auto-entered on load, so backing out of its
 * channels exits instead of showing a one-item desk list (the `> 1` guard,
 * and the one place the desk COUNT matters; see `escalationScreen`).
 */
export function escalationBack<C>(
  nav: EscalationNav<C>
): EscalationNav<C> | null {
  if (nav.confirmation !== null)
    return { ...nav, confirmation: null, activeChannel: null };
  if (nav.activeChannel !== null) return { ...nav, activeChannel: null };
  if (nav.activeDesk !== null && (nav.desks?.length ?? 0) > 1)
    return { ...nav, activeDesk: null };
  return null;
}
