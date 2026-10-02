/**
 * A Teammate's seed: the Member's chosen `avatarSeed`, else its id.
 *
 * The seed before the id, so somebody who picks one keeps the same face across a
 * rename, and somebody who never touches it still gets a stable one. This is the
 * rule the old initials-and-hue avatar used, kept because it is the right one:
 * an avatar that changes when a Teammate is renamed reads as a new colleague.
 */
export function teammateAvatarSeed(teammate: {
  id: string;
  avatarSeed?: string | null;
}): string {
  return teammate.avatarSeed?.trim() || teammate.id;
}

/**
 * A person's seed: their user id, else their email address.
 *
 * The id first because it survives an email change, and because a member's
 * address is not always known to the surface drawing them. The email is the
 * fallback rather than the display name: two people called Marco Rossi would
 * otherwise share a face, and a name is the field most likely to be edited.
 *
 * A pending invite has no user id and is seeded from the address it was sent to,
 * which means the face somebody sees on the invite row is the face they keep
 * once they accept.
 */
export function personAvatarSeed(person: {
  userId?: string | null;
  email?: string | null;
}): string | null {
  return person.userId?.trim() || person.email?.trim() || null;
}

/**
 * A channel roster entry's seed, resolved against the Teammates in the channel.
 *
 * The entry itself carries only an id and a name, so a Teammate that picked an
 * `avatarSeed` needs the Teammate row to find it. Without this the two places a
 * roster is drawn disagreed: the header strip looked the seed up, the "Who is
 * here" panel seeded from the id, and one Teammate wore two faces on the same
 * screen. A Member has no seed to look up and is its own id, per
 * `personAvatarSeed`.
 */
export function rosterAvatarSeed(
  entry: { id: string; kind: "member" | "teammate" },
  teammates: { id: string; avatarSeed?: string | null }[],
): string {
  if (entry.kind !== "teammate") return entry.id;
  const teammate = teammates.find((t) => t.id === entry.id);
  return teammate ? teammateAvatarSeed(teammate) : entry.id;
}
