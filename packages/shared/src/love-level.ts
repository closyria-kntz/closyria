import { z } from "zod";

/** How much she loves a wish: 1 Bof, 2 J'aime, 3 Mims, 4 En feu. Lives here so `opinions` and `wardrobe` need no import cycle. */
export const loveLevelSchema = z.number().int().min(1).max(4);
export type LoveLevel = z.infer<typeof loveLevelSchema>;
