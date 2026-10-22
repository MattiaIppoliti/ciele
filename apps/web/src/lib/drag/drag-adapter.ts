"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import {
  attachClosestEdge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import type { DropEdge } from "@/lib/work/drop-position";

/**
 * The one module that imports Pragmatic drag and drop (#1040, #1064).
 *
 * Its entry points changed in three majors in fourteen weeks, so every import
 * lives here and a major is a one-file change. What the rest of the app sees
 * is three hooks over plain data: a draggable Task, a drop target that knows
 * which edge was hit, and an auto-scrolling area. Every drag also has a
 * non-drag path (a "Move to" picker or a date picker), which is the keyboard
 * route WCAG 2.5.7 asks for.
 */

export interface DraggedTask {
  type: "work-task";
  taskId: string;
}

export function isDraggedTask(
  data: Record<string | symbol, unknown>
): data is Record<string | symbol, unknown> & DraggedTask {
  return data.type === "work-task" && typeof data.taskId === "string";
}

/** Makes an element draggable as a Task; returns whether it is being dragged. */
export function useDraggableTask(
  ref: RefObject<HTMLElement | null>,
  taskId: string,
  { disabled = false, handleRef }: { disabled?: boolean; handleRef?: RefObject<HTMLElement | null> } = {}
): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || disabled) return;
    // A handle arms the drag on pointer down rather than through the library's
    // `dragHandle`, which asks what is under the pointer when `dragstart` fires:
    // by then the pointer has travelled past the drag threshold, and off a
    // 14px grip a quick pull cancels the drag.
    const handle = handleRef?.current ?? null;
    let armed = false;
    const arm = () => {
      armed = true;
    };
    const disarm = () => {
      armed = false;
    };
    handle?.addEventListener("pointerdown", arm);
    window.addEventListener("pointerup", disarm);
    const cleanup = draggable({
      element,
      canDrag: () => !handle || armed,
      getInitialData: () => ({ type: "work-task", taskId }) satisfies DraggedTask,
      // The browser's own preview photographs the element's compositing layer,
      // and inside the console shell that layer is the whole page: dragging a
      // row dragged a translucent copy of the sidebar and everything else.
      // A detached copy of the element is the only thing in the picture.
      onGenerateDragPreview: ({ nativeSetDragImage, location, source }) => {
        const rect = source.element.getBoundingClientRect();
        const { clientX, clientY } = location.current.input;
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: () => ({ x: clientX - rect.left, y: clientY - rect.top }),
          render: ({ container }) => {
            const copy = source.element.cloneNode(true) as HTMLElement;
            copy.style.width = `${rect.width}px`;
            copy.style.height = `${rect.height}px`;
            copy.style.background = "var(--content)";
            container.append(copy);
          },
        });
      },
      onDragStart: () => setDragging(true),
      onDrop: () => {
        disarm();
        setDragging(false);
      },
    });
    return () => {
      cleanup();
      handle?.removeEventListener("pointerdown", arm);
      window.removeEventListener("pointerup", disarm);
    };
  }, [ref, taskId, disabled, handleRef]);
  return dragging;
}

export interface DropTargetState {
  /** A Task is over this target. */
  over: boolean;
  /** For an edged target: the edge nearest the pointer. */
  edge: DropEdge | null;
}

/**
 * Makes an element a drop target for Tasks. `edges` targets (a card, a row)
 * report the closest top or bottom edge; a column or a day has none.
 */
export function useTaskDropTarget(
  ref: RefObject<HTMLElement | null>,
  {
    data,
    edges = false,
    disabled = false,
    onDrop,
  }: {
    data: Record<string, unknown>;
    edges?: boolean;
    disabled?: boolean;
    onDrop: (taskId: string, edge: DropEdge | null) => void;
  }
): DropTargetState {
  const [state, setState] = useState<DropTargetState>({ over: false, edge: null });
  const key = JSON.stringify(data);
  // The latest handler without re-registering the target on every render.
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });
  useEffect(() => {
    const element = ref.current;
    if (!element || disabled) return;
    const own = JSON.parse(key) as Record<string, unknown>;
    const readEdge = (self: { data: Record<string | symbol, unknown> }): DropEdge | null => {
      const edge = extractClosestEdge(self.data);
      return edge === "top" || edge === "bottom" ? edge : null;
    };
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isDraggedTask(source.data),
      getData: ({ input, element: el }) =>
        edges ? attachClosestEdge(own, { input, element: el, allowedEdges: ["top", "bottom"] }) : own,
      getIsSticky: () => true,
      onDragEnter: ({ self }) => setState({ over: true, edge: edges ? readEdge(self) : null }),
      onDrag: ({ self }) => {
        const edge = edges ? readEdge(self) : null;
        setState((current) => (current.over && current.edge === edge ? current : { over: true, edge }));
      },
      onDragLeave: () => setState({ over: false, edge: null }),
      onDrop: ({ self, source, location }) => {
        setState({ over: false, edge: null });
        // Only the innermost target acts: a card inside a column both receive
        // the drop, and the card is the more precise answer.
        if (location.current.dropTargets[0]?.element !== element) return;
        if (isDraggedTask(source.data)) onDropRef.current(source.data.taskId, edges ? readEdge(self) : null);
      },
    });
  }, [ref, key, edges, disabled]);
  return state;
}

/** Scrolls an overflowing container while a Task is dragged near its edges. */
export function useAutoScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return combine(
      autoScrollForElements({ element, canScroll: ({ source }) => isDraggedTask(source.data) }),
      monitorForElements({ canMonitor: ({ source }) => isDraggedTask(source.data) })
    );
  }, [ref]);
}
