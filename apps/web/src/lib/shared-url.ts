const HTTP_URL = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}»]+$/;

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const firstUrlIn = (text: string | undefined): string | null => {
  const found = text?.match(HTTP_URL)?.[0];
  return found ? found.replace(TRAILING_PUNCTUATION, "") : null;
};

/**
 * The link of a Web Share Target request: `url` when it is an http(s) address, else the first http(s)
 * address found in `text` (Android puts it there), then in `title`.
 */
export function extractSharedUrl(params: {
  url?: string | undefined;
  text?: string | undefined;
  title?: string | undefined;
}): string | null {
  const direct = params.url?.trim();
  if (direct && isHttpUrl(direct)) return direct;
  return firstUrlIn(params.text) ?? firstUrlIn(params.title);
}
