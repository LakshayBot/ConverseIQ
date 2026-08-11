// ============================================================================
// Severity — the priority scale shared by the intelligence card and the
// card anatomy. Register-aware (nocturne vs dawn) accent colors.
// ============================================================================

export type Severity = 'high' | 'medium' | 'low'

export const SEV_COLOR: Record<Severity, string> = {
  high: 'var(--sev-high)',
  medium: 'var(--sev-med)',
  low: 'var(--sev-low)',
}
