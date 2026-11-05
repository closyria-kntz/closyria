/** Raw result of one extraction method, before validation. */
export type Candidate = {
  name: string;
  brand?: string | undefined;
  description?: string | undefined;
  currency?: string | undefined;
  priceCents: number;
  compareAtCents?: number | undefined;
  images: string[];
  sizes: { label: string; available: boolean; priceCents?: number }[];
  externalId?: string | undefined;
  siteName?: string | undefined;
};
