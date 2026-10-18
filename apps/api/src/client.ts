import { hc } from "hono/client";
import type { AppType } from "./app";

/** Typed API client shared with the web app (and mobile later). */
export const createApiClient = (baseUrl: string, init?: RequestInit) => hc<AppType>(baseUrl, init ? { init } : {});

export type { AppType };
