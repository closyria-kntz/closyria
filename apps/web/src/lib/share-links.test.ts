import { describe, expect, it } from "vitest";
import { shareLinks } from "./share-links";

describe("shareLinks", () => {
  const links = shareLinks({ text: "Robe d’été chez Zara & Co", url: "https://zara.com/fr/robe.html?a=1&b=2" });
  const message = "Robe d’été chez Zara & Co https://zara.com/fr/robe.html?a=1&b=2";

  it("WhatsApp: the text and the link in one encoded message", () => {
    expect(links.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(message)}`);
    expect(links.whatsapp).toContain("%C3%A9t%C3%A9%20chez%20Zara%20%26%20Co");
    expect(links.whatsapp).not.toContain(" ");
  });

  it("SMS: the message as the body", () => {
    expect(links.sms).toBe(`sms:?&body=${encodeURIComponent(message)}`);
  });

  it("E-mail: the text as the subject, the message as the body", () => {
    expect(links.email).toBe(
      `mailto:?subject=${encodeURIComponent("Robe d’été chez Zara & Co")}&body=${encodeURIComponent(message)}`,
    );
    // The link's own `&` cannot end the body early.
    expect(new URL(links.email).search).not.toContain("&b=2");
  });

  it("Messenger: only the link, encoded", () => {
    expect(links.messenger).toBe("fb-messenger://share/?link=https%3A%2F%2Fzara.com%2Ffr%2Frobe.html%3Fa%3D1%26b%3D2");
  });

  it("a text that already holds the link is not followed by it twice", () => {
    const url = "https://closyria.com/l/abc";
    const { sms } = shareLinks({ text: `Commande groupée : ajoute tes articles ici 👉 ${url}`, url });
    expect(decodeURIComponent(sms.slice("sms:?&body=".length))).toBe(
      `Commande groupée : ajoute tes articles ici 👉 ${url}`,
    );
  });
});
