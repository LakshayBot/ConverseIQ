// Meeting-title display helper - shared by the home "Recent meetings" card
// and the sidebar's recent-meetings list so both surfaces render the same
// labels:
//   - custom (user-renamed) titles are shown verbatim,
//   - default "Meeting <timestamp>" titles (minted by the desktop at
//     recording start) are also shown verbatim, matching the sidebar's
//     Meetings section - no label rewriting.
export function meetingDisplayTitle(m: { title: string; createdAt?: string }): string {
  const raw = (m.title ?? '').trim();
  return raw && raw !== 'Untitled session' ? raw : 'Untitled session';
}
