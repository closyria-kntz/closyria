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
  /**
   * The `d=` domains of its DKIM-Signature headers, lower case, as written (not verified here: only a hint of the
   * shop, like a link). An automatic forward keeps the shop's; a manual one carries her mailbox's.
   */
  signers: string[];
};

/** `d=` of each DKIM-Signature header. */
function dkimSigners(headers: { key: string; value: string }[]): string[] {
  return headers
    .filter((h) => h.key.toLowerCase() === "dkim-signature")
    .flatMap((h) => {
      const d = /(?:^|;)\s*d\s*=\s*([^;\s]+)/i.exec(h.value.replace(/\s+/g, " "))?.[1];
      return d ? [d.toLowerCase().replace(/\.$/, "")] : [];
    });
}

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
    signers: dkimSigners(email.headers ?? []),
  };
}
