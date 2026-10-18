import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  const schema = z.object({ PORT: z.coerce.number().int() });

  it("returns parsed values", () => {
    expect(parseEnv(schema, { PORT: "3001" })).toEqual({ PORT: 3001 });
  });

  it("exits on invalid configuration", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    parseEnv(schema, { PORT: "abc" });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls[0]?.[0]).toContain("PORT");
    exit.mockRestore();
    error.mockRestore();
  });
});
