import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { cn } from "@/lib/utils";

/**
 * The faces of a group, as one mark the size of a single Teammate's avatar.
 *
 * A group row on the roster sits beside Teammate cards, so it has to read as one
 * item at one glance, not as a strip of avatars that grows with the membership.
 * Three slots in a triangle, always: two faces on top and the rest of the room
 * as a `+N` below them. A triangle rather than the usual overlapping line
 * because a line is as wide as its contents and would make every group row a
 * different width, and because the point here is "this is a group", not "here is
 * everyone".
 *
 * **Everybody in the room, not only the Teammates.** A group is people and
 * agents together, and a group of five colleagues with no Teammate in it yet is
 * a normal group, not an empty one: seeding this from the Teammates alone drew
 * nothing at all for exactly that case.
 *
 * Deliberately faces only. No count under it and no rating beside it: the row's
 * own heading and its member line already say what this is, and the cluster is
 * an identity, not a statistic.
 */
export function GroupAvatarCluster({
  faces,
  participantCount,
  size = "md",
  className,
}: {
  /**
   * The room, in the order it should be drawn. At most the first two get a face.
   * `seed` is resolved by the caller, because a Teammate's face comes from its
   * `avatarSeed` and a person's from their user id, and the cluster should not
   * have to know which of the two it is holding.
   */
  faces: { id: string; seed: string }[];
  /**
   * Everyone in the group, people and Teammates. Not always `faces.length`: a
   * seat whose row this Member cannot resolve still counts towards the `+N`.
   */
  participantCount: number;
  /**
   * `"sm"` for a conversation-rail row, where the cluster sits beside single
   * Teammate avatars drawn at `size-9` and has to occupy the same square. The
   * triangle only reads as one mark when the box and the faces shrink together:
   * three `size-7` faces in a `size-9` box overflow it and land off-centre.
   */
  size?: "sm" | "md";
  className?: string;
}) {
  const shown = faces.slice(0, 2);
  const rest = Math.max(0, participantCount - shown.length);
  const small = size === "sm";
  const faceSize = small ? "size-6" : "size-7";

  return (
    <div
      className={cn("relative shrink-0", small ? "size-9" : "size-11", className)}
      // Decorative: the group's name is beside it, and the line under the name
      // says how many Teammates and people are in it.
      aria-hidden
    >
      {shown.map((face, index) => (
        <GeneratedAvatar
          key={face.id}
          seed={face.seed}
          size={faceSize}
          // Top-left and top-right of the triangle. `ring-background` keeps the
          // two apart where they overlap, the same trick the channel header's
          // roster strip uses.
          className={cn(
            "ring-background absolute top-0 ring-2",
            index === 0 ? "left-0" : "right-0"
          )}
        />
      ))}
      {rest > 0 && (
        <span
          // The triangle's lower vertex. Centred rather than offset, so a group
          // with one face and a `+N` still reads as a cluster.
          className={cn(
            "bg-muted text-muted-foreground ring-background absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full font-semibold ring-2",
            faceSize,
            small ? "text-[10px]" : "text-[11px]"
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
