import { describe, expect, it } from "vitest";
import { mailboxHelp } from "./order-inbox-help";

describe("mailboxHelp", () => {
  it("automatic forwarding off: only « Transférer » one e-mail at a time, for every mailbox", () => {
    const help = mailboxHelp(false, true);
    expect(help.map((m) => m.one)).toEqual(["gmail.one", "outlook.one", "icloud.one"]);
    expect(help.map((m) => m.auto)).toEqual([null, null, null]);
  });

  it("automatic forwarding on: the steps, with Gmail's code when one arrived", () => {
    const [gmail, outlook, icloud] = mailboxHelp(true, true);
    expect(gmail?.auto).toEqual(["gmail.auto1", "gmail.auto2", "gmail.auto3Code", "gmail.auto4"]);
    expect(outlook?.auto).toEqual(["outlook.auto1", "outlook.auto2", "outlook.auto3"]);
    expect(icloud?.auto).toEqual(["icloud.auto"]);
    expect(mailboxHelp(true, false)[0]?.auto).toContain("gmail.auto3");
  });
});
