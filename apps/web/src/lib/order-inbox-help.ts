/**
 * The help of « Mes commandes par e-mail », by mailbox, as message keys under `Orders.inbox`: « Transférer » one e-mail
 * at a time always; the automatic steps only while Gmail's automatic forwarding is accepted (`autoForward`,
 * INBOUND_AUTOFORWARD) — otherwise those e-mails would be ignored (spec §10.1, §10.6).
 */
export type MailboxHelp = { name: string; one: string; auto: readonly string[] | null };

export function mailboxHelp(autoForward: boolean, hasGmailCode: boolean): MailboxHelp[] {
  return [
    {
      name: "gmail.name",
      one: "gmail.one",
      auto: autoForward
        ? ["gmail.auto1", "gmail.auto2", hasGmailCode ? "gmail.auto3Code" : "gmail.auto3", "gmail.auto4"]
        : null,
    },
    {
      name: "outlook.name",
      one: "outlook.one",
      auto: autoForward ? ["outlook.auto1", "outlook.auto2", "outlook.auto3"] : null,
    },
    { name: "icloud.name", one: "icloud.one", auto: autoForward ? ["icloud.auto"] : null },
  ];
}
