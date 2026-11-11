"use client";

import { createContext, useContext } from "react";

/** Opens « Ajouter un article » (the + sheet of the shell); null outside the app shell. */
export const AddSheetContext = createContext<(() => void) | null>(null);

export const useOpenAddSheet = () => useContext(AddSheetContext);
