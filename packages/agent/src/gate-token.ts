import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed link a Flow gate hands to whoever may close it.
 *
 * Two gates need one: Human review (#841) gives a Member a decision page, and
 * the callback gate (#842) gives an external system a callback URL. Both are
 * reached by someone the console has not authenticated at the moment they
 * arrive, so in both cases the token *is* the authorization, and getting it
 * wrong is the same mistake twice.
 *
 * Hence one factory rather than two near-identical implementations. What
 * differs between the two is exactly the three arguments below.
 *
 * The shape: `base64url(expiryMs:id).signature`. The expiry is inside the
 * signed material, so a link that leaked, out of a mailbox or out of the other
 * system's request log, stops working on its own rather than relying on the
 * row it names still being open.
 */

export type GateTokenVerdict =
  | { ok: true; id: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unconfigured" };

export interface GateTokens {
  mint(subject: { id: string; expiresAt: string }): string;
  verify(token: string, options?: { now?: Date; graceMs?: number }): GateTokenVerdict;
}

/**
 * @param domain Domain separation. A token minted for one gate must never
 *   verify against the other, so this string is folded into the key.
 * @param defaultGraceMs How long past the row's own expiry a link still
 *   verifies. Not laxity, and not authorization: the row's own state decides
 *   whether anything happens (a review already expired accepts no decision, a
 *   webhook past its wait accepts no callback). What the grace buys is the
 *   verdict `expired` instead of `bad_signature`, so a surface that wants to
 *   distinguish the two can. The callback route logs the difference; the
 *   review page currently answers not-found for both.
 */
export function gateTokens(domain: string, defaultGraceMs: number): GateTokens {
  function key(): Buffer {
    const secret = process.env.APP_ENCRYPTION_KEY;
    if (!secret) {
      throw new Error(`APP_ENCRYPTION_KEY is not set; required to sign ${domain} links.`);
    }
    return createHmac("sha256", secret).update(domain).digest();
  }

  const sign = (payload: string) =>
    createHmac("sha256", key()).update(payload).digest("base64url");

  return {
    mint(subject) {
      const payload = Buffer.from(
        `${Date.parse(subject.expiresAt)}:${subject.id}`
      ).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },

    verify(token, options = {}) {
      const [payload, signature, ...rest] = token.split(".");
      if (!payload || !signature || rest.length > 0) return { ok: false, reason: "malformed" };
      let expected: string;
      try {
        expected = sign(payload);
      } catch {
        return { ok: false, reason: "unconfigured" };
      }
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, reason: "bad_signature" };
      }
      const decoded = Buffer.from(payload, "base64url").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator <= 0) return { ok: false, reason: "malformed" };
      const expiresMs = Number(decoded.slice(0, separator));
      const id = decoded.slice(separator + 1);
      if (!Number.isFinite(expiresMs) || !id) return { ok: false, reason: "malformed" };
      const grace = options.graceMs ?? defaultGraceMs;
      if ((options.now ?? new Date()).getTime() > expiresMs + grace) {
        return { ok: false, reason: "expired" };
      }
      return { ok: true, id };
    },
  };
}
