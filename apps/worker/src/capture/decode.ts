const HEAD_BYTES = 2_048;

/** `charset` of a `content-type` header, or of a `<meta charset>` / `http-equiv` tag in the first bytes. */
function charsetOf(contentType: string, body: Buffer): string {
  const header = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (header) return header;
  const head = body.subarray(0, HEAD_BYTES).toString("latin1");
  return /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? "utf-8";
}

/** Text of a fetched body, decoded with its declared charset (UTF-8 by default and for an unknown label). */
export function decodeBody(body: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType, body)).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
