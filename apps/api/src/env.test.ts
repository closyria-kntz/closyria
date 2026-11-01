import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

const base = {
  DATABASE_URL: "postgresql:///closyria",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3001",
};
const prod = { ...base, APP_ENV: "prod", BETTER_AUTH_URL: "https://closyria.com" };

describe("envSchema", () => {
  it("defaults to the memory mailer and the Closyria sender outside prod", () => {
    const env = envSchema.parse(base);
    expect(env.MAIL_TRANSPORT).toBe("memory");
    expect(env.MAIL_FROM).toEqual({ name: "Closyria", email: "bonjour@closyria.com" });
  });

  it("requires a secret of at least 32 characters", () => {
    expect(envSchema.safeParse({ ...base, BETTER_AUTH_SECRET: "short" }).success).toBe(false);
  });

  it("requires Brevo on dev.closyria.com too, which needs real codes", () => {
    const dev = { ...base, APP_ENV: "dev", BETTER_AUTH_URL: "https://dev.closyria.com" };
    expect(envSchema.safeParse(dev).success).toBe(false);
    expect(envSchema.safeParse({ ...dev, MAIL_TRANSPORT: "memory" }).success).toBe(false);
    expect(envSchema.safeParse({ ...dev, MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" }).success).toBe(true);
  });

  it("requires Brevo in prod", () => {
    expect(envSchema.safeParse(prod).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, MAIL_TRANSPORT: "memory" }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" }).success).toBe(true);
  });

  it("requires an API key when the transport is Brevo", () => {
    expect(envSchema.safeParse({ ...base, MAIL_TRANSPORT: "brevo" }).success).toBe(false);
  });

  it("requires an https auth URL outside development, so cookies are secure", () => {
    const dev = { ...base, APP_ENV: "dev", MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" };
    expect(envSchema.safeParse(dev).success).toBe(false);
    expect(envSchema.safeParse({ ...dev, BETTER_AUTH_URL: "https://dev.closyria.com" }).success).toBe(true);
  });

  it("parses a sender written as Name <address>", () => {
    const env = envSchema.parse({ ...base, MAIL_FROM: "Équipe Closyria <equipe@closyria.com>" });
    expect(env.MAIL_FROM).toEqual({ name: "Équipe Closyria", email: "equipe@closyria.com" });
    expect(envSchema.safeParse({ ...base, MAIL_FROM: "pas une adresse" }).success).toBe(false);
  });

  it("leaves Google and Apple off when their variables are absent", () => {
    const env = envSchema.parse(base);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.APPLE_CLIENT_ID).toBeUndefined();
  });

  it("requires both the id and the secret of a social provider, or neither", () => {
    for (const [id, secret] of [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET"],
    ] as const) {
      expect(envSchema.safeParse({ ...base, [id]: "id" }).success).toBe(false);
      expect(envSchema.safeParse({ ...base, [secret]: "secret" }).success).toBe(false);
      expect(envSchema.safeParse({ ...base, [id]: "id", [secret]: "secret" }).success).toBe(true);
    }
  });
});
