"use client";

import dynamic from "next/dynamic";

/* The coda picture on /features/assistants: the widget preview playing its
   scripted conversation on loop, standing alone under the claim rather than
   framed inside the admin shell (the hero above already shows the shell).
   Split into its own chunk: it pulls the real chat components (Thinking
   panel, markdown, shiki) that the rest of the marketing bundle never needs. */
const AssistantPreviewDemo = dynamic(
  () =>
    import("./assistant-preview-demo").then(
      (module) => module.AssistantPreviewDemo
    ),
  { ssr: false, loading: () => <div className="h-full" /> }
);

export function PreviewCoda() {
  return (
    /* 640px is the height the launcher gives the floating widget, so the
       conversation gets exactly the room it has in production. No foot mask
       here, unlike the shots above: those are windows onto a screen that
       keeps going, this is the whole chat surface, and fading it out would
       cut the composer and the AI disclaimer off its bottom edge. */
    <div className="mx-auto h-[640px] w-full">
      <AssistantPreviewDemo
        className="bg-transparent px-0 pt-0 sm:px-0 sm:pt-0"
        cardClassName="max-w-none"
      />
    </div>
  );
}
