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

  it("E-mail: the given subject (the sheet's title), never the message with its link", () => {
    const url = "https://closyria.com/l/abc";
    const { email } = shareLinks({ text: `Commande groupée 👉 ${url}`, url, subject: "Commande chez Zara" });
    expect(email).toBe(
      `mailto:?subject=${encodeURIComponent("Commande chez Zara")}&body=${encodeURIComponent(`Commande groupée 👉 ${url}`)}`,
    );
  });

  it("E-mail without a subject: the text, the link taken out of it", () => {
    const url = "https://closyria.com/l/abc";
    const { email } = shareLinks({ text: `Commande groupée : ajoute tes articles ici 👉 ${url}`, url });
    const subject = decodeURIComponent(new URL(email).searchParams.get("subject") ?? "");
    expect(subject).toBe("Commande groupée : ajoute tes articles ici 👉");
    expect(email.split("&body=")[0]).not.toContain(encodeURIComponent(url));
  });

  it("a lone surrogate (an emoji cut in half) does not throw: it becomes �", () => {
    const cut = "Robe 👗".slice(0, -1);
    const links = shareLinks({ text: cut, url: "https://a.fr/p" });
    expect(links.sms).toBe(`sms:?&body=${encodeURIComponent("Robe \uFFFD https://a.fr/p")}`);
    expect(() => shareLinks({ text: "\uDC00x", url: "https://a.fr/\uD800" })).not.toThrow();
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
