import { describe, expect, it } from "vitest";
import { deleteConfirmed, userDeleteErrorKey } from "./admin-users";

describe("deleteConfirmed", () => {
  it("wants her e-mail, whatever the case and the spaces around", () => {
    expect(deleteConfirmed(" Anna@Example.com ", "anna@example.com")).toBe(true);
    expect(deleteConfirmed("anna@example.co", "anna@example.com")).toBe(false);
    expect(deleteConfirmed("SUPPRIMER", "anna@example.com")).toBe(false);
  });

  it("wants « SUPPRIMER » in capitals for a guest", () => {
    expect(deleteConfirmed("SUPPRIMER", null)).toBe(true);
    expect(deleteConfirmed("supprimer", null)).toBe(false);
    expect(deleteConfirmed("", null)).toBe(false);
  });
});

describe("userDeleteErrorKey", () => {
  it("names each refusal of the API", () => {
    expect(userDeleteErrorKey(400, { error: "confirmation_mismatch" })).toBe("mismatch");
    expect(userDeleteErrorKey(409, { error: "self" })).toBe("self");
    expect(userDeleteErrorKey(409, { error: "admin" })).toBe("admin");
    expect(userDeleteErrorKey(404, { error: "not_found" })).toBe("notFound");
    expect(userDeleteErrorKey(0, null)).toBe("generic");
    expect(userDeleteErrorKey(500, {})).toBe("generic");
  });
});
