"use client";

import dynamic from "next/dynamic";

/* The coda picture on /features/teammates: a group thread where one message
   reaches two Teammates. Its own chunk, like the widget preview beside it: it
   pulls the real chat components (Thinking panel, markdown, shiki) that no
   other marketing page needs. */
const GroupChatDemo = dynamic(
  () => import("./group-chat-demo").then((module) => module.GroupChatDemo),
  { ssr: false, loading: () => <div className="h-[820px]" /> }
);

export function GroupCoda() {
  return <GroupChatDemo />;
}
