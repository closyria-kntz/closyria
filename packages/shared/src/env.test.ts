import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { allOrNoneIssues, appEnvObject, parseEnv } from "./env";

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

describe("appEnvObject", () => {
  const schema = appEnvObject({});

  it("defaults APP_ENV to development outside production builds", () => {
    expect(schema.parse({}).APP_ENV).toBe("development");
    expect(schema.parse({ NODE_ENV: "development" }).APP_ENV).toBe("development");
  });

  it("requires APP_ENV explicitly when NODE_ENV=production", () => {
    const result = schema.safeParse({ NODE_ENV: "production" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["APP_ENV"]);
    expect(schema.parse({ NODE_ENV: "production", APP_ENV: "prod" }).APP_ENV).toBe("prod");
  });
});

describe("allOrNoneIssues", () => {
  const names = ["A_ONE", "A_TWO", "A_THREE"] as const;
  const message = "required (all A_* variables go together)";

  it("is happy with all of them or none", () => {
    expect(allOrNoneIssues({}, names, message)).toEqual([]);
    expect(allOrNoneIssues({ A_ONE: "1", A_TWO: "2", A_THREE: "3" }, names, message)).toEqual([]);
  });

  it("names each missing one when only some are set (an empty value counts as missing)", () => {
    expect(allOrNoneIssues({ A_TWO: "2", A_THREE: "" }, names, message)).toEqual([
      { path: "A_ONE", message },
      { path: "A_THREE", message },
    ]);
  });
});
