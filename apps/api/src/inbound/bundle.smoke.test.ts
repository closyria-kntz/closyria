import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "tsdown";
import { afterAll, describe, expect, it } from "vitest";
import apiBuild from "../../tsdown.config";
import type { mailauthSenderCheck as SenderCheckFactory } from "./sender";
import {
  envelopeFrom,
  FIXTURE_GOOGLE,
  fixtureResolver,
  gmailForward,
  HER,
  INBOX_DOMAIN,
  signed,
} from "./test-fixtures";

/**
 * The sender check, bundled exactly as the API is (tsdown.config.ts: everything bundled, mailauth, postal-mime and
 * tldts included), then imported from the bundle and run on a fixture: what the tests prove of the sources still holds
 * once bundled (no file mailauth would read at run time, no lost Public Suffix List).
 */
const out = await mkdtemp(join(tmpdir(), "closyria-api-bundle-"));
afterAll(() => rm(out, { recursive: true, force: true }));

describe("the bundled sender check", () => {
  it("accepts her forward and ignores someone else's", async () => {
    const config = Array.isArray(apiBuild) ? apiBuild[0] : apiBuild;
    await build({
      ...config,
      config: false,
      entry: { sender: resolve(import.meta.dirname, "sender.ts") },
      outDir: out,
      sourcemap: false,
      logLevel: "error",
    });
    const file = (await readdir(out)).find((f) => f.startsWith("sender") && f.endsWith(".mjs"));
    if (!file) throw new Error("no bundle");
    const bundled = (await import(pathToFileURL(join(out, file)).href)) as {
      mailauthSenderCheck: typeof SenderCheckFactory;
    };
    const check = bundled.mailauthSenderCheck({
      mta: "mx.closyria.com",
      resolver: fixtureResolver(),
      google: FIXTURE_GOOGLE,
    });
    const to = `marie-k7f2@${INBOX_DOMAIN}`;
    const mine = await signed(gmailForward(to), "gmail");
    expect(await check({ raw: mine, envelope: envelopeFrom("gmail", HER, to), accountEmail: HER })).toEqual({
      kind: "accepted",
      fromAddress: HER,
    });
    const sophie = "sophie.autre@gmail.example";
    const theirs = await signed(gmailForward(to, `Sophie <${sophie}>`), "gmail");
    expect((await check({ raw: theirs, envelope: envelopeFrom("gmail", sophie, to), accountEmail: HER })).kind).toBe(
      "ignored",
    );
  }, 60_000);
});
