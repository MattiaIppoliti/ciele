import { redirect } from "next/navigation";

/** The hub's index tab (PRD #726). */
export default function KnowledgeIndexPage() {
  redirect("/knowledge/websites");
}
