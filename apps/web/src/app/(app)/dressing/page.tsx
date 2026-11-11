import { redirect } from "next/navigation";
import { oldViewRedirect } from "@/lib/articles-address";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The old address of this view: « Mes articles », with its step and every parameter (refonte Boudoir, spec §3.1). */
export default async function Page({ searchParams }: Props) {
  redirect(oldViewRedirect("dressing", await searchParams));
}
