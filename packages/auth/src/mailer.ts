export type MailMessage = { to: string; subject: string; text: string; html: string };

export type Mailer = { send(msg: MailMessage): Promise<void> };

export type MailSender = { name: string; email: string };

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

/** Sends through the Brevo transactional e-mail API. */
export function brevoMailer(options: { apiKey: string; from: MailSender; fetch?: typeof fetch }): Mailer {
  const send = options.fetch ?? fetch;
  return {
    async send(msg) {
      const res = await send(BREVO_URL, {
        method: "POST",
        headers: { "api-key": options.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: options.from,
          to: [{ email: msg.to }],
          subject: msg.subject,
          textContent: msg.text,
          htmlContent: msg.html,
        }),
      });
      // Never put the recipient or the content in the error: it ends up in logs.
      if (!res.ok) throw new Error(`Brevo refused the e-mail (HTTP ${res.status})`);
    },
  };
}

/**
 * Keeps messages in memory, for tests and development.
 * Logs only the subject: the address and the content (which holds the code) stay out of the logs.
 */
export function memoryMailer(): Mailer & { messages: MailMessage[] } {
  const messages: MailMessage[] = [];
  return {
    messages,
    async send(msg) {
      messages.push(msg);
      console.log(`[mail:memory] message kept in memory: "${msg.subject}"`);
    },
  };
}
