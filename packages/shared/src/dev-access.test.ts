import { describe, expect, it } from "vitest";
import { DEV_ACCESS_COOKIE, devAccessErrorSchema, devAccessInputSchema } from "./dev-access";

describe("dev access", () => {
  it("names the cookie Caddy checks (deploy/caddy/dev.closyria.com.caddy)", () => {
    expect(DEV_ACCESS_COOKIE).toBe("closyria_dev_access");
  });

  it("takes a non-empty password of reasonable length, nothing else", () => {
    expect(devAccessInputSchema.safeParse({ password: "un mot de passe" }).success).toBe(true);
    expect(devAccessInputSchema.safeParse({ password: "" }).success).toBe(false);
    expect(devAccessInputSchema.safeParse({ password: "x".repeat(201) }).success).toBe(false);
    expect(devAccessInputSchema.safeParse({}).success).toBe(false);
    expect(devAccessInputSchema.safeParse({ password: 12345678 }).success).toBe(false);
  });

  it("answers with stable error codes", () => {
    for (const error of ["wrong_password", "rate_limited", "invalid_request"]) {
      expect(devAccessErrorSchema.parse({ error })).toEqual({ error });
    }
    expect(devAccessErrorSchema.safeParse({ error: "other" }).success).toBe(false);
  });
});
