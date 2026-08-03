// ============================================================================
// Kind meta — signal type → label + icon, shared by the hero window,
// the signal lab and the card anatomy.
// ============================================================================

import type { IntelligenceKind } from '@/data/content'
import {
  IconCompetitor,
  IconObjection,
  IconPricing,
  IconProduct,
  IconRecommendation,
  IconTechnical,
} from './icons'

export const KIND_META: Record<
  IntelligenceKind,
  { label: string; icon: React.ReactNode }
> = {
  product: { label: 'Product match', icon: <IconProduct size={11} /> },
  competitor: { label: 'Competitor', icon: <IconCompetitor size={11} /> },
  objection: { label: 'Objection', icon: <IconObjection size={11} /> },
  pricing: { label: 'Pricing', icon: <IconPricing size={11} /> },
  technical: { label: 'Technical', icon: <IconTechnical size={11} /> },
  recommendation: { label: 'Talking point', icon: <IconRecommendation size={11} /> },
}

export function kindMeta(kind: string): { label: string; icon: React.ReactNode } {
  return KIND_META[kind as IntelligenceKind] ?? {
    label: kind,
    icon: <IconRecommendation size={11} />,
  }
}
