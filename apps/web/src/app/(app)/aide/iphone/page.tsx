import { redirect } from "next/navigation";

/** The old address of the iPhone help: it now lives in « Ajouter depuis ton téléphone », on its iPhone part. */
export default function Page(): never {
  redirect("/aide/telephone#iphone");
}
