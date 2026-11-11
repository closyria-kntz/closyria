/** The addresses that open each app with the message ready (the share window's choices). */
export type ShareLinks = { whatsapp: string; sms: string; email: string; messenger: string };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `encodeURIComponent` throws on half an emoji (a lone surrogate, from a cut name): it becomes « � » instead. */
export function encodeText(value: string): string {
  const wellFormed = (value as { toWellFormed?: () => string }).toWellFormed;
  try {
    return encodeURIComponent(typeof wellFormed === "function" ? wellFormed.call(value) : value);
  } catch {
    return encodeURIComponent(value.replace(LONE_SURROGATE, "�"));
  }
}

/**
 * The message to send is the text followed by the link (once: a text that already holds it is kept as is). WhatsApp,
 * SMS and e-mail get the whole message, encoded; Messenger only takes the link. The e-mail's subject is `subject` (the
 * window's title), else the text with the link taken out — never the link itself.
 */
export function shareLinks({ text, url, subject }: { text: string; url: string; subject?: string }): ShareLinks {
  const message = text.includes(url) ? text : `${text} ${url}`.trim();
  const body = encodeText(message);
  const emailSubject = subject?.trim() || text.split(url).join(" ").replace(/\s+/g, " ").trim();
  return {
    whatsapp: `https://wa.me/?text=${body}`,
    sms: `sms:?&body=${body}`,
    email: `mailto:?subject=${encodeText(emailSubject)}&body=${body}`,
    messenger: `fb-messenger://share/?link=${encodeText(url)}`,
  };
}
