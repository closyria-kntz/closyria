"use client";

import type { OrderView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteOrder } from "@/lib/orders-client";
import { Dialog } from "./dialog";
import { moreButtonClass, primaryButtonClass } from "./ui";

/**
 * What she does with a whole order, on « Mes commandes » and in the « Commande / colis » block of an article
 * (2026-11-15): « Supprimer la commande », after a confirmation. Her articles stay.
 */

/** « Supprimer la commande »: a confirmation, then the order goes (`onDeleted`); her articles stay. */
export function DeleteOrderAction({ order, onDeleted }: { order: OrderView; onDeleted: (orderId: string) => void }) {
  const t = useTranslations("Orders.manage");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async () => {
    setBusy(true);
    setFailed(false);
    const result = await deleteOrder(order.id);
    setBusy(false);
    // Already gone (another tab): it is gone all the same.
    if (!result.ok && result.error !== "not_found") return setFailed(true);
    setOpen(false);
    onDeleted(order.id);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setOpen(true);
        }}
        className={moreButtonClass}
      >
        {t("delete")}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("deleteTitle")} closeLabel={t("cancel")}>
        <p>{t("deleteBody")}</p>
        {failed && (
          <p role="alert" className="text-sm text-danger">
            {t("failed")}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className={`${primaryButtonClass} min-h-touch-target self-start`}
        >
          {t("deleteConfirm")}
        </button>
      </Dialog>
    </>
  );
}
