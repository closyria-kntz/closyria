import { defaultLocale, loadMessages } from "@closyria/i18n";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  // No locale in the URL; a later task reads the user's profile here.
  const locale = defaultLocale;
  return { locale, messages: loadMessages(locale) };
});
