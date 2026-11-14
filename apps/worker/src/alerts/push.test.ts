import { describe, expect, it } from "vitest";
import { outcomeOfStatus } from "./push";

describe("outcomeOfStatus", () => {
  it("reads the push service's answer", () => {
    expect(outcomeOfStatus(201)).toBe("ok");
    expect(outcomeOfStatus(404)).toBe("gone");
    expect(outcomeOfStatus(410)).toBe("gone");
    for (const status of [429, 500, 502, 503, undefined]) expect(outcomeOfStatus(status)).toBe("retry");
    for (const status of [400, 403, 413]) expect(outcomeOfStatus(status)).toBe("failed");
  });
});
