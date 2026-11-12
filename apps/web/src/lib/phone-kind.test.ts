import { describe, expect, it } from "vitest";
import { phoneKind } from "./phone-kind";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

describe("phoneKind", () => {
  it("tells an iPhone, an Android phone and a computer apart", () => {
    expect(phoneKind(IPHONE)).toBe("iphone");
    expect(phoneKind(ANDROID)).toBe("android");
    expect(phoneKind(DESKTOP)).toBeNull();
  });

  it("counts an iPad (a Mac with a touch screen) as an iPhone, a real Mac as a computer", () => {
    expect(phoneKind(IPAD, 5)).toBe("iphone");
    expect(phoneKind(IPAD, 0)).toBeNull();
    expect(phoneKind(IPAD)).toBeNull();
  });

  it("prefers the Apple device when an agent names both", () => {
    expect(phoneKind(`${IPHONE} Android`)).toBe("iphone");
  });
});
