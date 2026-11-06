"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PhotoViewer } from "@/components/photo-viewer";

/** The cover of a shared item, opening the viewer on the photo(s) the list shows for it. */
export function CoverPhoto({
  photos,
  name,
}: {
  photos: { url: string; width: number; height: number }[];
  name: string;
}) {
  const t = useTranslations("Media.viewer");
  const [viewing, setViewing] = useState<number | null>(null);
  const first = photos[0];
  if (!first) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t("openOf", { name })}
        onClick={() => setViewing(0)}
        className="size-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid"
      >
        {/* biome-ignore lint/performance/noImgElement: photos come from our own API, already resized. */}
        <img src={first.url} alt="" loading="lazy" decoding="async" className="card-photo size-full object-contain" />
      </button>
      <PhotoViewer photos={photos} index={viewing} alt={name} onClose={() => setViewing(null)} />
    </>
  );
}
