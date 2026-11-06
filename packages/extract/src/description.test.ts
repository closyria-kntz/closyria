import { describe, expect, it } from "vitest";
import { cleanRichText } from "./clean";

describe("cleanRichText (descriptions: paragraphs, line breaks and lists kept, no markup)", () => {
  it("keeps paragraphs as blank lines and <br> as line breaks", () => {
    expect(cleanRichText("<p>Robe longue.</p><p>Coupe ample<br>Col V</p>", 5000)).toBe(
      "Robe longue.\n\nCoupe ample\nCol V",
    );
  });

  it("turns list items into bullets, one per line", () => {
    expect(
      cleanRichText("<p>Composition :</p><ul><li>70 % coton</li><li> 30 % lin </li></ul><p>Lavage 30°</p>", 5000),
    ).toBe("Composition :\n\n• 70 % coton\n• 30 % lin\n\nLavage 30°");
  });

  it("keeps the line breaks of plain text and collapses runs of blank lines", () => {
    expect(cleanRichText("Ligne 1\r\nLigne   2\n\n\n\nLigne 3  ", 5000)).toBe("Ligne 1\nLigne 2\n\nLigne 3");
  });

  it("drops scripts, styles and other tags, and decodes entities once", () => {
    expect(
      cleanRichText(
        '<div><b>Doux</b> &amp; <a href="x">chaud</a><script>evil()</script></div><style>p{}</style>&lt;3',
        5000,
      ),
    ).toBe("Doux & chaud\n<3");
    expect(cleanRichText("&lt;p&gt;Échappé&lt;/p&gt;&lt;p&gt;Deux&lt;/p&gt;", 5000)).toBe("Échappé\n\nDeux");
  });

  it("treats headings, divs and table rows as line breaks", () => {
    expect(
      cleanRichText(
        "<h3>Détails</h3><div>Taille M</div><table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>",
        5000,
      ),
    ).toBe("Détails\nTaille M\nA B\nC");
  });

  it("caps the length and returns undefined when empty", () => {
    expect(cleanRichText("<p>abcdef</p>", 3)).toBe("abc");
    expect(cleanRichText("<p> </p><br>", 5000)).toBeUndefined();
    expect(cleanRichText(42, 5000)).toBeUndefined();
  });
});
