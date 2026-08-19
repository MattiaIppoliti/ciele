/**
 * Best-effort display name from an email local part, the schema stores emails
 * but not full names. e.g. "marco.iecher@example.com" -> "Marco Iecher".
 */
export function memberDisplayName(email: string | null | undefined): string {
  if (!email) return "Unknown"
  const local = email.split("@")[0]
  const words = local.split(/[._-]+/).filter(Boolean)
  if (words.length === 0) return email
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

/** Two-letter initials for an avatar bubble, derived from an email. */
export function memberInitials(email: string | null | undefined): string {
  const name = memberDisplayName(email)
  if (name === "Unknown") return "?"
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  )
}
