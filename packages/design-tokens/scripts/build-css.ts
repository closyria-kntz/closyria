import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderTokensCss } from "../src/index";

const target = resolve(import.meta.dirname, "../../../apps/web/src/styles/tokens.css");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderTokensCss());
console.log(`tokens: wrote ${target}`);
