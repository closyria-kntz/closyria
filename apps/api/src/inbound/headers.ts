/**
 * The header fields of a raw message, unfolded, in order (top first). Only for the checks of sender.ts: To, Cc and
 * From are read here, the bytes DKIM verified are the same ones.
 */
export function headerFields(raw: Buffer): { name: string; value: string }[] {
  const text = raw.toString("latin1");
  const end = text.search(/\r?\n\r?\n/);
  const block = end === -1 ? text : text.slice(0, end);
  const fields: { name: string; value: string }[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length > 0) {
      const last = fields[fields.length - 1] as { name: string; value: string };
      last.value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    fields.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() });
  }
  return fields;
}

/** The value without its quoted strings and comments (a display name or a comment never counts as an address). */
function bare(value: string): string {
  return value.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\((?:[^()\\]|\\.)*\)/g, " ");
}

/** True for a group (`Amis: a@b, c@d;`), which RFC 5322 allows in From and which is never accepted here. */
export function isGroup(value: string): boolean {
  return bare(value).includes(":");
}

/** The addresses of an address list (To, Cc), in lowercase. */
export function addressesOf(value: string): string[] {
  const found: string[] = [];
  for (const m of bare(value).matchAll(/<([^<>\s]+@[^<>\s]+)>|([^\s<>,;:"]+@[^\s<>,;:"]+)/g)) {
    // A bare address may end a sentence: its final dot is not part of it.
    found.push((m[1] ?? (m[2] ?? "").replace(/\.+$/, "")).toLowerCase());
  }
  return found;
}

/** A plain ASCII address (`local@domain`, one `@`): internationalized ones are not accepted as her sender. */
export function isAsciiAddress(address: string): boolean {
  return /^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+$/.test(address);
}

/** Decodes RFC 2047 encoded words (`=?utf-8?Q?TR=A0:_…?=`) well enough to read a subject's prefix. */
export function decodeEncodedWords(value: string): string {
  const joined = value.replace(/\?=\s+=\?/g, "?==?");
  return joined.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (whole, charset: string, encoding: string, text: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === "b"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
                "latin1",
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return whole;
      }
    },
  );
}

/**
 * True when every line of the header block is either a continuation (leading space or tab, never first) or a strict
 * `name:` line (printable ASCII name, nothing between it and the colon). Anything else (`Subject\r\n : x`, a stray
 * line without a colon, a control character) could be read one way by DKIM and another way by `headerFields`, so
 * such a message is never trusted.
 */
export function headersWellFormed(raw: Buffer): boolean {
  const text = raw.toString("latin1");
  const end = text.search(/\r?\n\r?\n/);
  const block = end === -1 ? text : text.slice(0, end);
  if (/\r(?!\n)|[\0\v\f]/.test(block)) return false;
  const lines = block.split(/\r?\n/);
  return lines.every((line, i) => (i > 0 && /^[ \t]/.test(line)) || /^[\x21-\x39\x3b-\x7e]+:/.test(line));
}
