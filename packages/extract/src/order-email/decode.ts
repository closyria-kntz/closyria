import PostalMime from "postal-mime";
import { cleanLines, htmlToText } from "./html-text";

/** An e-mail as the readers need it; attachments are never read. */
export type DecodedEmail = {
  subject: string;
  /** The sender of the message received (her own mailbox for a manual forward, the shop for an automatic one). */
  from: { name: string; address: string } | null;
  date: Date | null;
  /** Its text: the HTML part as lines when there is one (it says more than the text part), else the text part. */
  text: string;
  html: string | null;
};

/** Decodes a raw message (MIME). Attachments are left aside, links never fetched. */
export async function decodeEmail(raw: Uint8Array | ArrayBuffer | string): Promise<DecodedEmail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const html = email.html?.trim() ? email.html : null;
  const date = email.date ? new Date(email.date) : null;
  return {
    subject: (email.subject ?? "").replace(/\s+/g, " ").trim(),
    from: email.from?.address ? { name: email.from.name ?? "", address: email.from.address.toLowerCase() } : null,
    date: date && Number.isFinite(date.getTime()) ? date : null,
    text: html ? htmlToText(html) : cleanLines(email.text ?? ""),
    html,
  };
}
