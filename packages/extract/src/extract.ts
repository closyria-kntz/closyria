import { type CaptureMethod, type ExtractedProduct, extractedProductSchema } from "@closyria/shared";
import { extractJsonLd } from "./jsonld";
import { extractOpenGraph } from "./opengraph";
import type { Candidate } from "./types";

export type ExtractInput = { url: string; contentType: string; body: string; shopifyJson?: string };
export type ExtractResult =
  | { ok: true; method: CaptureMethod; product: ExtractedProduct }
  | { ok: false; error: "not_a_product" | "invalid_data" };

type Method = { method: CaptureMethod; run: (input: ExtractInput) => Candidate | null };

// Task 4 adds `shopify` (from input.shopifyJson) at the head of this list.
const METHODS: Method[] = [
  { method: "jsonld", run: (i) => extractJsonLd(i.body, i.url) },
  { method: "opengraph", run: (i) => extractOpenGraph(i.body, i.url) },
];

export function extract(input: ExtractInput): ExtractResult {
  if (!/html|xml/i.test(input.contentType) || input.body === "") return { ok: false, error: "not_a_product" };
  for (const { method, run } of METHODS) {
    const candidate = run(input);
    if (!candidate) continue;
    const parsed = extractedProductSchema.safeParse({
      ...candidate,
      currency: candidate.currency ?? "EUR",
      platform: "other",
    });
    return parsed.success ? { ok: true, method, product: parsed.data } : { ok: false, error: "invalid_data" };
  }
  return { ok: false, error: "not_a_product" };
}
