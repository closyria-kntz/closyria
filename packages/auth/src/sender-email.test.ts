import { describe, expect, it } from "vitest";
import { senderCodeEmail } from "./server";

describe("senderCodeEmail (« Mes adresses d'envoi », spec §11)", () => {
  it("writes the code e-mail in French, the code in the subject and the text", () => {
    const mail = senderCodeEmail("marie@hotmail.example", "048213");
    expect(mail.to).toBe("marie@hotmail.example");
    expect(mail.subject).toBe("Ton code Closyria : 048213");
    expect(mail.text).toBe(
      "048213\n\nRecopie ce code dans Closyria pour ajouter cette adresse à tes adresses d'envoi. Il est valable 15 minutes. Si tu n'as rien demandé, ignore cet e-mail.",
    );
    expect(mail.html).toContain("<strong>048213</strong>");
    expect(mail.html).toContain("Recopie ce code dans Closyria");
    expect(mail.unlogged).toBe(true);
  });
});
