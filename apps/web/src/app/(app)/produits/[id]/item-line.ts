import type { ItemView } from "@closyria/shared";
import type { Step } from "@/lib/wardrobe-view";

/** The line's four steps, in order (spec R8). */
export const LINE = ["envie", "commande", "recu", "dressing"] as const satisfies readonly Step[];
type LineStep = (typeof LINE)[number];

/**
 * Where her article is on the line « Envie · Commandé · Reçu · Dans mon dressing ». `owned` is « Reçu » or « Dans mon
 * dressing » as the server says (`received`); on sale, sold or returned, the line stays on « Dans mon dressing » and a
 * small chip says the rest (`status`).
 */
export function lineOf(item: Pick<ItemView, "stage" | "received">): {
  current: LineStep;
  status: "for_sale" | "sold" | "returned" | null;
} {
  switch (item.stage) {
    case "spotted":
      return { current: "envie", status: null };
    case "ordered":
      return { current: "commande", status: null };
    case "owned":
      return { current: item.received ? "recu" : "dressing", status: null };
    default:
      return { current: "dressing", status: item.stage };
  }
}
