import { redirect } from "next/navigation";

/** The Library's index tab (PRD #726). */
export default function LibraryIndexPage() {
  redirect("/library/websites");
}
