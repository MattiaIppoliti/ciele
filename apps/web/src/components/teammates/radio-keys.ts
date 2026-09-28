import type { KeyboardEvent } from "react";

/**
 * Arrow-key movement for a row of `role="radio"` buttons, the keyboard half of
 * a radiogroup: only the checked option sits in the tab order, so the arrows
 * are how a keyboard reaches the others, and moving selects, as a native
 * radio does.
 */
export function onRadioKeyDown(event: KeyboardEvent<HTMLElement>) {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)')
  );
  const index = radios.indexOf(event.currentTarget);
  if (index < 0 || radios.length < 2) return;
  event.preventDefault();
  const next = radios[(index + step + radios.length) % radios.length];
  next.focus();
  next.click();
}
