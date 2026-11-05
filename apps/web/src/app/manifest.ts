import { defaultSemanticTokens } from "@closyria/design-tokens";
import type { MetadataRoute } from "next";

/** PWA manifest. `share_target` makes the installed app appear in Android's share sheet (GET /partager). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Closyria",
    short_name: "Closyria",
    display: "standalone",
    start_url: "/",
    background_color: defaultSemanticTokens["color-surface"],
    theme_color: defaultSemanticTokens["color-accent"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/partager",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
