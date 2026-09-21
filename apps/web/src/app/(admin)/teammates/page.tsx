import { MessageSquareDashed } from "lucide-react";

/**
 * `/teammates` with nothing open: the right pane's placeholder.
 *
 * Everything that used to be here, the roster, the groups and the create
 * dialogs, moved into the layout beside it, because the rail has to outlive
 * navigation between threads. Below `lg` this pane is hidden and the rail is
 * the page, so this sentence is a desktop one.
 */
export default function TeammatesPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="text-primary/40 flex size-24 items-center justify-center rounded-full border-2 border-dashed">
        <MessageSquareDashed className="size-10" />
      </span>
      <h2 className="text-xl font-bold">Pick a teammate or a group</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        A teammate is an AI colleague your team chats with inside Ciele. It
        answers from the knowledge you already curated in the Library, and it
        never talks to your website visitors.
      </p>
    </div>
  );
}
