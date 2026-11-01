import { afterEach, describe, expect, it, vi } from "vitest";
import { brevoMailer, memoryMailer } from "./mailer";

const message = { to: "alice@example.test", subject: "Sujet", text: "Code 123456", html: "<p>Code 123456</p>" };
const from = { name: "Closyria", email: "bonjour@closyria.com" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("brevoMailer", () => {
  it("posts the message to the Brevo transactional API", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 201 }));
    await brevoMailer({ apiKey: "key-123", from, fetch }).send(message);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("api-key")).toBe("key-123");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      sender: from,
      to: [{ email: "alice@example.test" }],
      subject: "Sujet",
      textContent: "Code 123456",
      htmlContent: "<p>Code 123456</p>",
    });
  });

  it("throws on a non-2xx answer, without the address or the content", async () => {
    const fetch = vi.fn(async () => new Response("bad", { status: 401 }));
    const error = await brevoMailer({ apiKey: "k", from, fetch })
      .send(message)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain("alice");
    expect(String(error)).not.toContain("123456");
  });

  it("gives up on a hung request", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(brevoMailer({ apiKey: "k", from, fetch, timeoutMs: 20 }).send(message)).rejects.toThrow();
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("times out after 10 seconds by default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn(async () => new Response("{}", { status: 201 }));
    await brevoMailer({ apiKey: "k", from, fetch }).send(message);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});

describe("memoryMailer", () => {
  it("keeps messages and logs them without the address or the code", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mailer = memoryMailer();
    await mailer.send(message);

    expect(mailer.messages).toEqual([message]);
    expect(log).toHaveBeenCalled();
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("alice");
    expect(logged).not.toContain("123456");
  });
});

describe("memoryMailer in local development", () => {
  it("logs the content (the code) but never the address when asked to", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await memoryMailer({ logContent: true }).send(message);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("123456");
    expect(logged).not.toContain("alice");
  });

  it("keeps only the last 50 messages", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mailer = memoryMailer();
    for (let i = 0; i < 60; i++) await mailer.send({ ...message, subject: `m${i}` });
    expect(mailer.messages.length).toBe(50);
    expect(mailer.messages[0]?.subject).toBe("m10");
  });
});
