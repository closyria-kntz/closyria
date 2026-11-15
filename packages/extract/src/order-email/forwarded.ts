import { parseHeaderDate } from "./dates";
import type { DecodedEmail } from "./decode";

/** The original e-mail's header, read from a forward's quoted header. */
export type OriginalHeader = {
  fromName: string | null;
  fromAddress: string | null;
  date: Date | null;
  subject: string | null;
};

const LABELS = {
  from: /^(?:from|de)\s*:\s*(.*)$/i,
  date: /^(?:date|sent|envoyé|envoye)\s*:\s*(.*)$/i,
  subject: /^(?:subject|objet)\s*:\s*(.*)$/i,
};

/** Lines that open a forwarded message: Gmail, Outlook, Apple Mail, in English and French. */
const MARKER =
  /^(?:-{2,}\s*(?:forwarded message|message transf[ée]r[ée]|original message|message d'origine)\s*-{2,}|begin forwarded message\s*:|d[ée]but du message r[ée]exp[ée]di[ée]\s*:)$/i;

const ADDRESS = /<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+?)>?$/;

function sender(value: string): { name: string | null; address: string | null } {
  const match = ADDRESS.exec(value.trim());
  const address = match?.[1]?.toLowerCase() ?? null;
  const name = (match ? value.slice(0, match.index) : value).replace(/["“”]/g, "").trim();
  return { name: name || null, address };
}

/**
 * The header of the forwarded e-mail inside `email` (« De : Maison Lune <…> », « Date : … », « Objet : … »): after a
 * forward marker, or Outlook's header block (its first « De : » line followed by a date line). When the e-mail is no
 * forward (an automatic forward keeps the original headers), its own sender, date and subject.
 */
export function originalHeader(email: DecodedEmail): OriginalHeader {
  const lines = email.text.split("\n");
  let start = lines.findIndex((line) => MARKER.test(line));
  // Outlook writes no marker: its block starts at the « De : » line followed by « Envoyé : ».
  const outlook = lines.findIndex((line, i) => LABELS.from.test(line) && LABELS.date.test(lines[i + 1] ?? ""));
  if (start === -1 && outlook !== -1) start = outlook - 1;
  if (start === -1 && outlook === -1) {
    return {
      fromName: email.from?.name || null,
      fromAddress: email.from?.address ?? null,
      date: email.date,
      subject: email.subject || null,
    };
  }
  const header: OriginalHeader = { fromName: null, fromAddress: null, date: null, subject: null };
  for (const line of lines.slice(start + 1, start + 9)) {
    const from = LABELS.from.exec(line);
    const date = LABELS.date.exec(line);
    const subject = LABELS.subject.exec(line);
    if (from && header.fromAddress === null) {
      const s = sender(from[1] ?? "");
      header.fromName = s.name;
      header.fromAddress = s.address;
    } else if (date && header.date === null) {
      header.date = parseHeaderDate(date[1] ?? "");
    } else if (subject && header.subject === null) {
      header.subject = (subject[1] ?? "").trim() || null;
    }
  }
  return header;
}
