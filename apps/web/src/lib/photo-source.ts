export type PhotoSource = { kind: "file"; file: File } | { kind: "url"; url: string } | { kind: "none" };

/** What `photoSource` reads: a `DataTransfer` (paste, drop) or anything shaped like it. */
type TransferLike = { files: ArrayLike<File>; getData: (format: string) => string };

/** The text as an http(s) address, trimmed, or null. */
export function asHttpUrl(text: string): string | null {
  const value = text.trim();
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** What was pasted or dropped: its first image file, else a text that is an http(s) address, else nothing. */
export function photoSource(data: TransferLike | null): PhotoSource {
  if (!data) return { kind: "none" };
  const file = Array.from(data.files).find((candidate) => candidate.type.startsWith("image/"));
  if (file) return { kind: "file", file };
  // A link dragged from a page comes as `text/uri-list` (first non-comment line), a pasted one as plain text.
  const listed = data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((line) => line !== "" && !line.startsWith("#"));
  const url = asHttpUrl(data.getData("text/plain")) ?? (listed ? asHttpUrl(listed) : null);
  return url ? { kind: "url", url } : { kind: "none" };
}
