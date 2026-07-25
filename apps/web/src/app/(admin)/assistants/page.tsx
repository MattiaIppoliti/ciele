import { redirect } from "next/navigation";

// The assistants dashboard now lives at "/"; keep this path as a redirect so
// existing links and bookmarks to /assistants still resolve.
export default function AssistantsRedirect() {
  redirect("/");
}
