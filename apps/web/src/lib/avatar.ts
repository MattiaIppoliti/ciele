import { blobatar } from "blobatar";

/**
 * Generated avatars, for everyone in the console who has not uploaded a picture.
 *
 * Three surfaces needed the same thing and each had invented its own: a
 * Teammate carried initials over a hashed hue, a Member fell back to one grey
 * silhouette shared by the whole organization, and the members table drew that
 * silhouette itself. Initials collide (two Noras), a shared silhouette is not an
 * identity at all, and neither helps you find a row you have seen before.
 *
 * `blobatar` (MIT, zero dependencies) draws a deterministic geometric figure
 * from any string: the same seed is always the same avatar, so nothing has to be
 * stored, and a face is recognisable in a list in a way "NO" over teal is not.
 *
 * Deterministic, not random, and the distinction is the point. Nobody wants a
 * colleague who looks different on every page load, and a Teammate whose avatar
 * changed on each render would read as a different Teammate.
 *
 * The seed choice is the whole design here, so it lives in one place per subject
 * rather than at each call site: seeds decide identity, and an inconsistent one
 * is a person with two faces.
 */

/**
 * One set of options for every avatar the console draws.
 *
 * No `size`: without it the SVG carries only its `viewBox` and the element
 * around it decides how big it is, which is what lets one component serve a
 * 32px table row and a 44px roster card. `circle` because every avatar frame in
 * this app is already round, and a squared-off figure inside a round frame loses
 * its corners.
 */
const OPTIONS = { background: "circle" } as const;

/** The markup for one seed. Pure, so a snapshot of it is a stable test. */
export function generatedAvatar(seed: string): string {
  return blobatar(seed, OPTIONS);
}

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
