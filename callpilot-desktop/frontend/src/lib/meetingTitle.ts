// Meeting-title display helpers - shared by the home "Recent meetings" card
// and the sidebar's recent-meetings list so both surfaces render the same
// labels:
//   - user-renamed titles are shown verbatim,
//   - default "Meeting <timestamp>" titles (minted by the desktop at
//     recording start) render as a human-readable "Call - …" label.
export const AUTO_MEETING_TITLE =
  /^Meeting\s+\d{1,4}[-_]\d{1,2}[-_]\d{1,4}[-_]\d{2}[-_]\d{2}[-_]\d{2}$/;

/** "Call - Thu, Jul 30, 9:24 PM" - human-readable label for a default meeting. */
export function formatCallLabel(d: Date): string {
  const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Call - ${date}, ${time}`;
}

/** Primary label for a meeting row: custom titles verbatim, default titles
 *  derived from the server timestamp (the same instant as the filename). */
export function meetingDisplayTitle(m: { title: string; createdAt?: string }): string {
  const raw = (m.title ?? '').trim();
  const isCustom = raw && raw !== 'Untitled session' && !AUTO_MEETING_TITLE.test(raw);
  if (isCustom) return raw;
  if (m.createdAt) {
    const d = new Date(m.createdAt);
    if (!Number.isNaN(d.getTime())) return formatCallLabel(d);
  }
  return raw || 'Untitled session';
}
