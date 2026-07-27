const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Short public id in the style of "hAOzUt5m-cHI". */
export function shortId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += i === 8 ? "-" : ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
