type Side = "top" | "bottom";

export interface PopupBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Inline selects must fit their scrollport as well as the visible viewport. */
export function selectPopupGeometry(
  trigger: PopupBounds,
  boundary: PopupBounds,
  content: { height: number; width: number },
  preferred: Side = "bottom",
  heightLimit = 320,
) {
  const gap = 8;
  const edge = 8;
  const room = {
    top: Math.max(0, trigger.top - boundary.top - gap - edge),
    bottom: Math.max(0, boundary.bottom - trigger.bottom - gap - edge),
  };
  const other = preferred === "top" ? "bottom" : "top";
  const wantedHeight = Math.min(heightLimit, content.height);
  const side = room[preferred] < wantedHeight && room[other] > room[preferred]
    ? other
    : preferred;
  const maxWidth = Math.max(0, boundary.right - boundary.left - edge * 2);
  const width = Math.min(content.width, maxWidth);
  const left = Math.max(boundary.left + edge, Math.min(trigger.left, boundary.right - edge - width));
  return {
    side,
    maxHeight: Math.min(heightLimit, room[side]),
    maxWidth,
    leftOffset: left - trigger.left,
  };
}

/** Scroll only the list, leaving the form and the page at their current position. */
export function optionScrollDelta(
  option: { top: number; bottom: number },
  list: { top: number; bottom: number },
): number {
  if (option.top < list.top) return option.top - list.top;
  if (option.bottom > list.bottom) return option.bottom - list.bottom;
  return 0;
}
