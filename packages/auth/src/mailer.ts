export type MailMessage = { to: string; subject: string; text: string; html: string };

export type Mailer = { send(msg: MailMessage): Promise<void> };

export type MailSender = { name: string; email: string };

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

/** Sends through the Brevo transactional e-mail API. */
export function brevoMailer(options: {
  apiKey: string;
  from: MailSender;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Mailer {
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    async send(msg) {
      const res = await send(BREVO_URL, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
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

const MEMORY_MAILER_CAPACITY = 50;

/**
 * Keeps the last messages in memory, for tests and local development.
 * Logs the subject only, never the address. `logContent` adds the text (which holds the code)
 * so one can sign in locally: only ever enable it with APP_ENV=development.
 */
export function memoryMailer(options: { logContent?: boolean } = {}): Mailer & { messages: MailMessage[] } {
  const messages: MailMessage[] = [];
  return {
    messages,
    async send(msg) {
      messages.push(msg);
      if (messages.length > MEMORY_MAILER_CAPACITY) messages.splice(0, messages.length - MEMORY_MAILER_CAPACITY);
      console.log(`[mail:memory] message kept in memory: "${msg.subject}"`);
      if (options.logContent) console.log(msg.text);
    },
  };
}
