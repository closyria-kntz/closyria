/** The phone a browser runs on, for the « add from your phone » help: an iPhone (or iPad), an Android, or neither. */
export type PhoneKind = "iphone" | "android" | null;

/**
 * Read from the user agent; `maxTouchPoints` (the browser's, 0 on the server) tells an iPad, which says it is a Mac,
 * from a real Mac. An agent naming both an Apple device and Android counts as the Apple one.
 */
export function phoneKind(agent: string, maxTouchPoints = 0): PhoneKind {
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && maxTouchPoints > 1)) return "iphone";
  if (/Android/i.test(agent)) return "android";
  return null;
}
