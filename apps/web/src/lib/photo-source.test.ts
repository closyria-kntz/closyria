import { describe, expect, it } from "vitest";
import { photoSource } from "./photo-source";

function transfer(files: File[], text = "") {
  return { files, getData: (type: string) => (type === "text/plain" ? text : "") };
}
const png = new File(["x"], "a.png", { type: "image/png" });
const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });

describe("photoSource", () => {
  it("takes the first image file", () => {
    expect(photoSource(transfer([pdf, png]))).toEqual({ kind: "file", file: png });
  });
  it("ignores a file that is not an image", () => {
    expect(photoSource(transfer([pdf]))).toEqual({ kind: "none" });
  });
  it("takes text that is an http(s) address, trimmed", () => {
    expect(photoSource(transfer([], "  https://x.test/a.jpg \n"))).toEqual({
      kind: "url",
      url: "https://x.test/a.jpg",
    });
  });
  it("ignores other text", () => {
    expect(photoSource(transfer([], "bonjour"))).toEqual({ kind: "none" });
    expect(photoSource(transfer([], "ftp://x.test/a.jpg"))).toEqual({ kind: "none" });
  });
  it("reads a dropped link from uri-list", () => {
    const dropped = { files: [], getData: (type: string) => (type === "text/uri-list" ? "https://x.test/b.png" : "") };
    expect(photoSource(dropped)).toEqual({ kind: "url", url: "https://x.test/b.png" });
  });
  it("gives none for null", () => {
    expect(photoSource(null)).toEqual({ kind: "none" });
  });
});
