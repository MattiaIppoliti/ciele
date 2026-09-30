/**
 * The surface of an inline card in a chat transcript (help desk, referral,
 * approval, review) and of the widget's escalation rows. A hairline `border`
 * on the page background barely reads, so the card takes a tinted fill and a
 * ring. Both are surface alphas, which flip with the theme on their own, so
 * the card needs no `dark:` twin (DESIGN.md §2.2).
 *
 * Its own module so the widget can use it without importing the transcript.
 */
export const CHAT_CARD = "bg-alpha-medium ring-1 ring-alpha-strong";

/** The fill a pressable card takes on hover. */
export const CHAT_CARD_HOVER = "hover:bg-alpha-strong";
