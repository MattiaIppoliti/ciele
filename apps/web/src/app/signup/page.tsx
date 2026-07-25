import { permanentRedirect } from "next/navigation";

// Self-serve signup is closed: access is invite-only and sign-in is the only
// auth path. Anyone who lands on /signup (old links, bookmarks) is sent to the
// demo request instead. Kept as a redirect stub rather than a 404 so those
// links resolve somewhere useful.
export default function SignupPage() {
  permanentRedirect("/contact/sales");
}
