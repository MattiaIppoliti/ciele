import { notFound } from "next/navigation";
import { ChatShowcase } from "./showcase-client";

/**
 * Dev-only route: a scripted conversation exercising every beui chat
 * component (see showcase-client.tsx). Not part of the product — 404s in
 * production builds.
 */
export default function ChatShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChatShowcase />;
}
