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

const URL_PARAM = /(?:^\?|^|&)url=/;
const ENCODED_HTTP = /^https?%3A/i;

/**
 * The link of `/partager?url=…` read from the raw query (`location.search`): an iOS Shortcut may put the link there
 * without encoding it, so everything after the first `url=` is the link, its own `?` and `&` included. An encoded
 * link (the share target, a shortcut that encodes) is decoded, up to the next parameter. An unencoded link's fragment
 * is in `hash` (`location.hash`), put back after it. Null without an http(s) link.
 */
export function sharedUrlFromQuery(search: string, hash = ""): string | null {
  const found = URL_PARAM.exec(search);
  if (!found) return null;
  const raw = search.slice(found.index + found[0].length);
  let link = `${raw}${hash}`;
  if (ENCODED_HTTP.test(raw)) {
    try {
      link = decodeURIComponent(raw.split("&")[0] ?? "");
    } catch {
      return null;
    }
  }
  link = link.trim();
  return isHttpUrl(link) ? link : null;
}
