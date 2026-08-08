// intelligenceCards.ts - pure mapping from detection data to
// IntelligenceCards. No Tauri/HTTP dependencies so this module is
// unit-testable in isolation.
//
// The category architecture requires RAILS TO CONTAIN ENTITIES, not
// card titles:
//   - an event "ProductMentioned: Sprint 210" is an entity card
//   - the recommendation generated from it (Type == EventType,
//     TriggerEvent persisted) is MERGED into that card, so the rail keeps
//     the entity while the detail gains the intelligence
//   - generic-titled recommendations (legacy output such as
//     "Contextual Recommendation") never render as a bogus product

export interface IntelligenceCard {
  type: 'competitor_detected' | 'objection' | 'buying_signal' |
        'product_match' | 'pricing_discussion' | 'technical_question';
  title: string;
  body: string;
  severity: 'high' | 'medium' | 'low';
  chunks: string[];
}

export interface PastConversationEvent {
  id: string;
  eventType: string;
  entityName: string | null;
  confidence: number;
  supportingTranscript: string;
  detectedAt: string;
}

export interface PastRecommendation {
  id: string;
  type: string;
  title: string;
  summary: string;
  talkingPoint: string | null;
  keyFacts: string[] | null;
  priority: string | null;
  confidence: number;
  references: string[] | null;
  triggerEvent: string | null;
  provider: string | null;
  model: string | null;
  generatedAt: string;
}

/** Map eventType / type strings → IntelligenceCard type. Mirrors the
 *  live stream's CARD_TYPE_BY_EVENT / CARD_TYPE_BY_REC tables so past
 *  meetings render the same card category as the live panel. */
const PAST_EVENT_TYPE_BY_CARD: Record<string, IntelligenceCard['type']> = {
  ProductMentioned: 'product_match',
  CompetitorMentioned: 'competitor_detected',
  Objection: 'objection',
  BuyingSignal: 'buying_signal',
  PricingDiscussion: 'pricing_discussion',
  PricingQuestion: 'pricing_discussion',
  TechnicalQuestion: 'technical_question',
};

const PAST_REC_TYPE_BY_CARD: Record<string, IntelligenceCard['type']> = {
  ProductMentioned: 'product_match',
  CompetitorMentioned: 'competitor_detected',
  Objection: 'objection',
  BuyingSignal: 'buying_signal',
  PricingQuestion: 'pricing_discussion',
  PricingDiscussion: 'pricing_discussion',
  TechnicalQuestion: 'technical_question',
};

function severityFromConfidence(c: number | undefined): IntelligenceCard['severity'] {
  const v = typeof c === 'number' ? c : 0;
  if (v >= 0.9) return 'high';
  if (v >= 0.7) return 'medium';
  return 'low';
}

/**
 * Strip event/recommendation prefixes so a card reads as its ENTITY:
 *   "ProductMentioned: Sprint 210" → "Sprint 210"
 *   "Objection: Data residency"    → "Data residency"
 *   "Addressing Data residency"    → "Data residency"
 * A bare type word ("PricingDiscussion") is left untouched.
 */
export function entityDisplayName(title: string): string {
  return (
    title
      .replace(
        /^(?:ProductMentioned|CompetitorMentioned|BuyingSignal|PricingDiscussion|PricingQuestion|TechnicalQuestion|Objection|Addressing)[:\s]+/i,
        '',
      )
      .trim() || 'Signal'
  );
}

/** Server-generated recommendation titles that carry no entity identity. */
const GENERIC_REC_TITLES = new Set([
  'Contextual Recommendation',
  'Pricing Guidance',
  'Technical Reference',
  'Product Recommendation',
]);

function isGenericRecTitle(title: string): boolean {
  return GENERIC_REC_TITLES.has(title.trim()) || /^Addressing\s/i.test(title);
}

function recBodyOf(r: PastRecommendation): string {
  return r.talkingPoint || (r.keyFacts && r.keyFacts.length > 0)
    ? `${r.talkingPoint ?? ''}${
        r.keyFacts && r.keyFacts.length > 0
          ? `\n\n${r.keyFacts.map((f) => `• ${f}`).join('\n')}`
          : ''
      }`.trim()
    : (r.summary ?? '');
}

/**
 * Build IntelligenceCards from a past meeting's persisted events +
 * recommendations. Newest entries first (matches the live panel's
 * MAX_CARDS_VISIBLE ordering).
 *
 * Rails contain ENTITIES, so cards collapse per entity:
 *   - event cards carry the entity title ("ProductMentioned: X")
 *   - the recommendation generated from that event merges INTO the
 *     event card (richer body + knowledge references), one entity card
 *   - generic-titled recommendations (legacy server output) merge into
 *     the newest same-type event card - never a bogus entity
 *   - anything else dedupes by entity name
 */
export function buildPastIntelligenceCards(
  events: PastConversationEvent[],
  recommendations: PastRecommendation[],
): IntelligenceCard[] {
  const cards: IntelligenceCard[] = [];
  const seenEntities = new Set<string>();

  // Events first - chronological order, oldest at top.
  for (const e of events) {
    const cardType = PAST_EVENT_TYPE_BY_CARD[e.eventType];
    if (!cardType) continue;
    const titleEntity = e.entityName ? `: ${e.entityName}` : '';
    const title = `${e.eventType}${titleEntity}`;
    const entityKey = entityDisplayName(title).toLowerCase();
    if (seenEntities.has(entityKey)) continue;
    seenEntities.add(entityKey);
    cards.push({
      type: cardType,
      title,
      body: e.supportingTranscript ?? '',
      severity: severityFromConfidence(e.confidence),
      chunks: e.supportingTranscript ? [e.supportingTranscript] : [],
    });
  }

  // Recommendations: every recommendation merges into the card of the
  // entity it was generated for (the server generates exactly one rec per
  // event, Type == EventType). One entity card per rail item; the detail
  // gains the richer intelligence.
  //
  // The API returns recommendations newest-first, matching event order
  // (events are fetched oldest-first but the newest event is the newest
  // recommendation's trigger). Generic-titled recommendations (legacy
  // output such as "Contextual Recommendation") pair with the newest
  // still-available same-type event card; entity-titled recommendations
  // pair by entity identity.
  const genericPoolByType = new Map<IntelligenceCard['type'], IntelligenceCard[]>();
  for (const card of cards) {
    const pool = genericPoolByType.get(card.type) ?? [];
    pool.push(card);
    genericPoolByType.set(card.type, pool);
  }

  const mergeInto = (target: IntelligenceCard, r: PastRecommendation) => {
    const recBody = recBodyOf(r);
    if (recBody) target.body = recBody;
    if (Array.isArray(r.references) && r.references.length > 0) {
      for (const ref of r.references) {
        if (!target.chunks.includes(ref)) target.chunks.push(ref);
      }
    }
    if (r.priority) {
      target.severity = r.priority as IntelligenceCard['severity'];
    }
  };

  for (const r of recommendations) {
    const cardType = PAST_REC_TYPE_BY_CARD[r.type ?? ''] ?? 'buying_signal';
    if (!r.title) continue;
    const entityKey = entityDisplayName(r.title).toLowerCase();

    if (!isGenericRecTitle(r.title)) {
      // Entity-titled recommendation: merge into the same-type card of
      // that entity (event + rec collapse to one rail item), otherwise
      // it is its own card.
      const existing = cards.find(
        (c) => c.type === cardType && entityDisplayName(c.title).toLowerCase() === entityKey,
      );
      if (existing) {
        mergeInto(existing, r);
        continue;
      }
      const pool = genericPoolByType.get(cardType) ?? [];
      const generic = pool.find((c) => entityDisplayName(c.title).toLowerCase() === entityKey);
      if (generic) {
        mergeInto(generic, r);
        continue;
      }
      cards.push({
        type: cardType,
        title: r.title,
        body: recBodyOf(r),
        severity:
          (r.priority as IntelligenceCard['severity'] | null | undefined) ??
          severityFromConfidence(r.confidence),
        chunks: Array.isArray(r.references) ? r.references : [],
      });
      continue;
    }

    // Generic-titled recommendation (legacy server output): attach it to
    // the newest still-available same-type event card so the rail keeps
    // the ENTITY while the detail gains the intelligence. `cards` is
    // chronological (oldest first) and recs arrive newest-first, so the
    // newest rec pairs with the newest card - pop() from the end.
    const pool = genericPoolByType.get(cardType) ?? [];
    const eventCard = pool.pop();
    if (eventCard) {
      mergeInto(eventCard, r);
    } else {
      // No entity card to attach to (e.g. a contextual recommendation
      // whose event never produced a card): the intelligence still
      // exists and must be visible. It carries no entity identity, so it
      // belongs to the CONTEXTUAL category - never PRODUCTS.
      cards.push({
        type: 'buying_signal',
        title: r.title,
        body: recBodyOf(r),
        severity:
          (r.priority as IntelligenceCard['severity'] | null | undefined) ??
          severityFromConfidence(r.confidence),
        chunks: Array.isArray(r.references) ? r.references : [],
      });
    }
  }

  // Newest first to match live-panel ordering.
  return cards.reverse();
}
