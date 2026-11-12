import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The old « Moi » (navigation 2026-11-12): « Compte », with every parameter (the browser keeps the `#…`). */
export default async function Page({ searchParams }: Props) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, one);
  }
  const query = params.toString();
  redirect(query ? `/compte?${query}` : "/compte");
}
