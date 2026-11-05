import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

const base = {
  DATABASE_URL: "postgresql:///closyria",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3001",
};
const s3 = {
  S3_ENDPOINT: "https://s3.gra.io.cloud.ovh.net",
  S3_REGION: "gra",
  S3_BUCKET: "closyria-prod",
  S3_ACCESS_KEY_ID: "key-id",
  S3_SECRET_ACCESS_KEY: "secret-key",
};
const prod = { ...base, ...s3, APP_ENV: "prod", BETTER_AUTH_URL: "https://closyria.com" };

describe("envSchema", () => {
  it("defaults to the memory mailer and the Closyria sender outside prod", () => {
    const env = envSchema.parse(base);
    expect(env.MAIL_TRANSPORT).toBe("memory");
    expect(env.MAIL_FROM).toEqual({ name: "Closyria", email: "bonjour@closyria.com" });
  });

  it("requires APP_ENV explicitly in a production build", () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: "production" }).success).toBe(false);
    expect(envSchema.parse({ ...base, NODE_ENV: "production", APP_ENV: "development" }).APP_ENV).toBe("development");
  });

  it("accepts APP_ENV=test only with a loopback auth URL (R18)", () => {
    const test = { ...base, APP_ENV: "test" };
    for (const url of ["http://127.0.0.1:4000", "http://localhost:4000", "http://[::1]:4000"]) {
      expect(envSchema.safeParse({ ...test, BETTER_AUTH_URL: url }).success, url).toBe(true);
    }
    for (const url of ["https://dev.closyria.com", "https://closyria.com", "http://10.0.0.5:4000"]) {
      expect(envSchema.safeParse({ ...test, BETTER_AUTH_URL: url }).success, url).toBe(false);
    }
  });

  it("requires a secret of at least 32 characters", () => {
    expect(envSchema.safeParse({ ...base, BETTER_AUTH_SECRET: "short" }).success).toBe(false);
  });

  it("requires Brevo on dev.closyria.com too, which needs real codes", () => {
    const dev = { ...base, ...s3, APP_ENV: "dev", BETTER_AUTH_URL: "https://dev.closyria.com" };
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
    const dev = { ...base, ...s3, APP_ENV: "dev", MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" };
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

  it("keeps photos in memory in local development when S3 is not configured", () => {
    const env = envSchema.parse(base);
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(envSchema.parse({ ...base, ...s3 }).S3_BUCKET).toBe("closyria-prod");
  });

  it("requires every S3 variable outside development", () => {
    const ready = { ...prod, MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" };
    expect(envSchema.safeParse(ready).success).toBe(true);
    for (const name of Object.keys(s3)) {
      const { [name as keyof typeof s3]: _, ...missing } = ready;
      expect(envSchema.safeParse(missing).success, name).toBe(false);
    }
  });

  it("runs the browser tests (APP_ENV=test) on the memory mailer only, over http, without S3", () => {
    const test = { ...base, APP_ENV: "test", BETTER_AUTH_URL: "http://127.0.0.1:4310" };
    expect(envSchema.parse(test).MAIL_TRANSPORT).toBe("memory");
    expect(envSchema.safeParse({ ...test, MAIL_TRANSPORT: "memory" }).success).toBe(true);
    // The test e-mail route reads codes from memory: real e-mails are refused.
    expect(envSchema.safeParse({ ...test, MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" }).success).toBe(false);
  });

  it("requires all S3 variables together, even in development", () => {
    expect(envSchema.safeParse({ ...base, S3_BUCKET: "closyria-dev" }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, ...s3, S3_ENDPOINT: "not a url" }).success).toBe(false);
  });

  it("accepts TEST_STORAGE_DIR only with APP_ENV=test (browser tests: photos on disk, shared with the worker)", () => {
    const test = { ...base, APP_ENV: "test", BETTER_AUTH_URL: "http://127.0.0.1:4310" };
    expect(envSchema.parse({ ...test, TEST_STORAGE_DIR: "/tmp/closyria-e2e" }).TEST_STORAGE_DIR).toBe(
      "/tmp/closyria-e2e",
    );
    expect(envSchema.safeParse({ ...base, TEST_STORAGE_DIR: "/tmp/x" }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, APP_ENV: "development", TEST_STORAGE_DIR: "/tmp/x" }).success).toBe(false);
    const dev = { ...base, ...s3, APP_ENV: "dev", BETTER_AUTH_URL: "https://dev.closyria.com" };
    const brevo = { MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "key" };
    expect(envSchema.safeParse({ ...dev, ...brevo, TEST_STORAGE_DIR: "/tmp/x" }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, ...brevo, TEST_STORAGE_DIR: "/tmp/x" }).success).toBe(false);
    expect(envSchema.safeParse({ ...test, TEST_STORAGE_DIR: "" }).success).toBe(false);
  });
});
