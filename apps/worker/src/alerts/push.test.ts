import { describe, expect, it } from "vitest";
import { WebPushError } from "web-push";
import { outcomeOfStatus, type SendNotification, webPushSender } from "./push";

describe("outcomeOfStatus", () => {
  it("reads the push service's answer", () => {
    expect(outcomeOfStatus(201)).toBe("ok");
    expect(outcomeOfStatus(404)).toBe("gone");
    expect(outcomeOfStatus(410)).toBe("gone");
    for (const status of [429, 500, 502, 503, undefined]) expect(outcomeOfStatus(status)).toBe("retry");
    for (const status of [400, 403, 413]) expect(outcomeOfStatus(status)).toBe("failed");
  });
});

describe("webPushSender", () => {
  const vapid = { publicKey: "public", privateKey: "private", subject: "https://closyria.com" };
  const target = { endpoint: "https://push.example.test/1", keys: { p256dh: "p", auth: "a" } };
  const message = { title: "Ta taille est revenue", body: "Robe Iris : de retour en M", url: "/nouvelles" };

  it("passes the payload, a TTL, a 10 s timeout and the topic", async () => {
    const calls: unknown[] = [];
    const send: SendNotification = async (...args) => {
      calls.push(args);
      return { statusCode: 201 };
    };
    expect(await webPushSender(vapid, send)(target, message, { topic: "a".repeat(32) })).toBe("ok");
    expect(calls).toEqual([
      [
        target,
        JSON.stringify(message),
        {
          vapidDetails: { subject: vapid.subject, publicKey: "public", privateKey: "private" },
          TTL: 12 * 60 * 60,
          timeout: 10_000,
          topic: "a".repeat(32),
        },
      ],
    ]);
  });

  it("reads the status of a WebPushError, and a network error or socket timeout as busy", async () => {
    const failing = (error: unknown) => webPushSender(vapid, async () => Promise.reject(error));
    const options = { topic: "t" };
    expect(await failing(new WebPushError("gone", 410, {}, "", target.endpoint))(target, message, options)).toBe(
      "gone",
    );
    expect(await failing(new WebPushError("gone", 404, {}, "", target.endpoint))(target, message, options)).toBe(
      "gone",
    );
    expect(await failing(new WebPushError("busy", 429, {}, "", target.endpoint))(target, message, options)).toBe(
      "retry",
    );
    expect(await failing(new WebPushError("bad", 400, {}, "", target.endpoint))(target, message, options)).toBe(
      "failed",
    );
    expect(await failing(new Error("Socket timeout"))(target, message, options)).toBe("retry");
    expect(
      await failing(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))(
        target,
        message,
        options,
      ),
    ).toBe("retry");
  });
});
