import { type CaptureMethod, type ExtractedProduct, extractedProductSchema } from "@closyria/shared";
import { extractJsonLd } from "./jsonld";
import { extractOpenGraph } from "./opengraph";
import { extractShopify } from "./shopify";
import type { Candidate } from "./types";
import { withWooCommerce } from "./woocommerce";

export type ExtractInput = { url: string; contentType: string; body: string; shopifyJson?: string };
export type ExtractResult =
  | { ok: true; method: CaptureMethod; product: ExtractedProduct }
  | { ok: false; error: "not_a_product" | "invalid_data" };

type Method = {
  method: CaptureMethod;
  platform: "shopify" | "other";
  run: (input: ExtractInput) => Candidate | null;
};

const woo = (c: Candidate | null, i: ExtractInput) => (c ? withWooCommerce(c, i.body, i.url) : null);

const METHODS: Method[] = [
  { method: "shopify", platform: "shopify", run: (i) => (i.shopifyJson ? extractShopify(i.shopifyJson, i.url) : null) },
  { method: "jsonld", platform: "other", run: (i) => woo(extractJsonLd(i.body, i.url), i) },
  { method: "opengraph", platform: "other", run: (i) => woo(extractOpenGraph(i.body, i.url), i) },
];

export function extract(input: ExtractInput): ExtractResult {
  if (!/html|xml/i.test(input.contentType) || input.body === "") return { ok: false, error: "not_a_product" };
  for (const { method, platform, run } of METHODS) {
    const candidate = run(input);
    if (!candidate) continue;
    const parsed = extractedProductSchema.safeParse({
      ...candidate,
      currency: candidate.currency ?? "EUR",
      platform,
    });
    return parsed.success ? { ok: true, method, product: parsed.data } : { ok: false, error: "invalid_data" };
  }
  return { ok: false, error: "not_a_product" };
}
