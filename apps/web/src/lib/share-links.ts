/** The addresses that open each app with the message ready (the share window's choices). */
export type ShareLinks = { whatsapp: string; sms: string; email: string; messenger: string };

/**
 * The message to send is the text followed by the link (once: a text that already holds it is kept as is). WhatsApp,
 * SMS and e-mail get the whole message, encoded; Messenger only takes the link.
 */
export function shareLinks({ text, url }: { text: string; url: string }): ShareLinks {
  const message = text.includes(url) ? text : `${text} ${url}`.trim();
  const body = encodeURIComponent(message);
  return {
    whatsapp: `https://wa.me/?text=${body}`,
    sms: `sms:?&body=${body}`,
    email: `mailto:?subject=${encodeURIComponent(text)}&body=${body}`,
    messenger: `fb-messenger://share/?link=${encodeURIComponent(url)}`,
  };
}
