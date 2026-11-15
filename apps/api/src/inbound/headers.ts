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
    found.push((m[1] ?? m[2] ?? "").toLowerCase());
  }
  return found;
}

/** A plain ASCII address (`local@domain`, one `@`): internationalized ones are not accepted as her sender. */
export function isAsciiAddress(address: string): boolean {
  return /^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+$/.test(address);
}
