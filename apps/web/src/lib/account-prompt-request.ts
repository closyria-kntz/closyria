import { type PromptTrigger, readDismissedAt, shouldPromptAccount, showAccountPrompt } from "./account-prompt";
import { fetchSummary } from "./catalog-client";
import { track } from "./track";

/**
 * Asks whether to offer her an account now (G6) and shows the banner if so. Call it after a save (the product
 * sheet), a share (the lists) or a photo. Never throws, never blocks: a failed read just means no banner.
 */
export async function requestAccountPrompt(trigger: PromptTrigger): Promise<void> {
  try {
    const summary = await fetchSummary();
    if (!summary) return;
    const ask = shouldPromptAccount({
      isAnonymous: summary.isAnonymous,
      itemCount: summary.itemCount,
      trigger,
      dismissedAt: readDismissedAt(),
    });
    if (ask && showAccountPrompt()) track("account_prompt_shown", { trigger });
  } catch {}
}
