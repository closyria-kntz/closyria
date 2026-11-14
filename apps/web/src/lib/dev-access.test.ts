import { describe, expect, it } from "vitest";
import { devAccessErrorKey, devAccessReturnPath } from "./dev-access";

describe("devAccessReturnPath", () => {
  it("follows the path Caddy sent, query included, as it was written", () => {
    // Caddy writes `/acces-dev?suite={uri}` with the original path and query unencoded.
    expect(devAccessReturnPath("?suite=/articles")).toBe("/articles");
    expect(devAccessReturnPath("?suite=/articles?vue=liste&tri=prix")).toBe("/articles?vue=liste&tri=prix");
    expect(devAccessReturnPath("?suite=/produits/%C3%A9t%C3%A9")).toBe("/produits/%C3%A9t%C3%A9");
  });

  it("also reads an encoded path (a link written by hand)", () => {
    expect(devAccessReturnPath("?suite=%2Freglages%3Fonglet%3Dalertes")).toBe("/reglages?onglet=alertes");
  });

  it("goes home without a path, or with anything that is not a path of this site", () => {
    for (const search of [
      "",
      "?",
      "?suite=",
      "?autre=/articles",
      "?suite=//evil.example/",
      "?suite=%2F%2Fevil.example",
      "?suite=https://evil.example/",
      "?suite=https%3A%2F%2Fevil.example%2F",
      "?suite=/\\evil.example",
      "?suite=/.//evil.example",
      "?suite=javascript:alert(1)",
      "?suite=%E0%A4%A",
    ]) {
      expect(devAccessReturnPath(search), search).toBe("/");
    }
  });

  it("never comes back to the access page itself", () => {
    expect(devAccessReturnPath("?suite=/acces-dev")).toBe("/");
    expect(devAccessReturnPath("?suite=/acces-dev?suite=/articles")).toBe("/");
    expect(devAccessReturnPath("?suite=/acces-dev/")).toBe("/");
    expect(devAccessReturnPath("?suite=/acces-dev#haut")).toBe("/");
  });
});

describe("devAccessErrorKey", () => {
  it("names the message for each answer of the API", () => {
    expect(devAccessErrorKey(401)).toBe("wrongPassword");
    expect(devAccessErrorKey(429)).toBe("tooManyTries");
    for (const status of [0, 400, 404, 500, 502]) expect(devAccessErrorKey(status), String(status)).toBe("failed");
  });
});
