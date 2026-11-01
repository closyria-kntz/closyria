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
