// Manual script, never run by tests: node scripts/record-fixture.ts <url> <name>
// One request for the page, plus one for `<product url>.js` when the page is a Shopify one.
// Keeps only <head>, JSON-LD blocks and <meta> tags; the rest of <body> is dropped. No cookies are sent or stored.
import { mkdirSync, writeFileSync } from "node:fs";

const USER_AGENT = "Mozilla/5.0 (compatible; ClosyriaBot/1.0; +https://closyria.com)";
const [url, name] = process.argv.slice(2);
if (!url || !name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("usage: node scripts/record-fixture.ts <url> <name>");
  process.exit(2);
}

async function get(target: string): Promise<{ status: number; body: string }> {
  const res = await fetch(target, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  return { status: res.status, body: await res.text() };
}

const outDir = new URL("../fixtures/real/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const page = await get(url);
console.log(`${url} -> ${page.status}`);
if (page.status !== 200) process.exit(1);

const head = page.body.match(/<head\b[\s\S]*?<\/head\s*>/i)?.[0] ?? "";
const ldBlocks = page.body.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
const metas = page.body.match(/<meta\b[^>]*>/gi) ?? [];
const isShopify = page.body.includes("Shopify.shop") || page.body.includes("cdn.shopify.com");
const headWithoutScripts = head.replace(/<script\b(?![^>]*ld\+json)[\s\S]*?<\/script\s*>/gi, "");
const outHtml = [
  "<!doctype html><html>",
  headWithoutScripts || "<head></head>",
  "<body>",
  ...ldBlocks.filter((b) => !headWithoutScripts.includes(b)),
  ...metas.filter((m) => !headWithoutScripts.includes(m)),
  "</body></html>",
].join("\n");
writeFileSync(new URL(`${name}.html`, outDir), outHtml);
console.log(`saved ${name}.html (${outHtml.length} bytes, shopify=${isShopify})`);

if (isShopify) {
  const parsed = new URL(url);
  const jsUrl = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}.js`;
  await new Promise((r) => setTimeout(r, 1000));
  const js = await get(jsUrl);
  console.log(`${jsUrl} -> ${js.status}`);
  if (js.status !== 200) process.exit(1);
  JSON.parse(js.body);
  writeFileSync(new URL(`${name}.js.json`, outDir), js.body);
  console.log(`saved ${name}.js.json (${js.body.length} bytes)`);
}
