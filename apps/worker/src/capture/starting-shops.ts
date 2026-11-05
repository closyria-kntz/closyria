import { canonicalizeUrl, type ListingKind, type Platform } from "@closyria/shared";

export type StartingShop = {
  slug: string;
  name: string;
  domain: string;
  captureMode: "auto" | "manual";
  listingKind: ListingKind;
  platform: Platform;
  testUrl: string | null;
};

const canonical = (url: string): string => {
  const result = canonicalizeUrl(url);
  if (!result) throw new Error(`invalid test URL: ${url}`);
  return result;
};

const auto = (slug: string, name: string, domain: string, platform: Platform, testUrl: string): StartingShop => ({
  slug,
  name,
  domain,
  captureMode: "auto",
  listingKind: "catalog",
  platform,
  testUrl: canonical(testUrl),
});

const manual = (slug: string, name: string, domain: string, listingKind: ListingKind = "catalog"): StartingShop => ({
  slug,
  name,
  domain,
  captureMode: "manual",
  listingKind,
  platform: "other",
  testUrl: null,
});

/** The shops that exist from the first deploy; all published. */
export const STARTING_SHOPS: readonly StartingShop[] = [
  auto("mcb-paris", "MCB Paris", "mcb-paris.fr", "shopify", "https://www.mcb-paris.fr/products/produit-3679"),
  auto(
    "easy-clothes",
    "Easy Clothes",
    "easy-clothes.com",
    "shopify",
    "https://easy-clothes.com/products/jeans-joelle-bleu-240",
  ),
  auto("my1996", "My1996", "my1996.fr", "shopify", "https://my1996.fr/products/robe-camelia-rose-fonce"),
  auto("ohlala", "Ohlala", "ohlalaboutique.fr", "shopify", "https://ohlalaboutique.fr/products/veste-fourrure-bambi"),
  auto(
    "le-dressing-de-paolina",
    "Le Dressing de Paolina",
    "ledressingdepaolina.fr",
    "shopify",
    "https://ledressingdepaolina.fr/products/gilet-silvana-2",
  ),
  auto(
    "intemporel-shop",
    "Intemporel Shop",
    "intemporel.shop",
    "shopify",
    "https://intemporel.shop/products/jean-mahaut-a-pois",
  ),
  auto(
    "promod",
    "Promod",
    "promod.fr",
    "other",
    "https://www.promod.fr/fr-fr/bonnet-chaud-avec-de-la-laine-chocolat--p255230/",
  ),
  auto(
    "zalando",
    "Zalando",
    "zalando.fr",
    "other",
    "https://www.zalando.fr/adidas-sportswear-essentials-3-stripes-leggings-leggings-blackwhite-adq41e03i-q12.html",
  ),
  manual("zara", "Zara", "zara.com"),
  manual("mango", "Mango", "mango.com"),
  manual("hm", "H&M", "hm.com"),
  manual("sezane", "Sézane", "sezane.com"),
  manual("kiabi", "Kiabi", "kiabi.com"),
  manual("etam", "Etam", "etam.com"),
  manual("la-redoute", "La Redoute", "laredoute.fr"),
  manual("shein", "Shein", "shein.com"),
  manual("vinted", "Vinted", "vinted.fr", "secondhand"),
  manual("vestiaire-collective", "Vestiaire Collective", "vestiairecollective.com", "secondhand"),
];
