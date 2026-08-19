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
    <div
      className="mx-auto h-[640px] w-full overflow-hidden"
      /* Same dissolve as the feature window above: the widget is a view onto
         a conversation that keeps going, so it fades out instead of ending
         on its own border. */
      style={{
        maskImage: "linear-gradient(to bottom, black 78%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 78%, transparent 100%)",
      }}
    >
      <AssistantPreviewDemo
        className="bg-transparent px-0 pt-0 sm:px-0 sm:pt-0"
        cardClassName="max-w-none"
      />
    </div>
  );
}
