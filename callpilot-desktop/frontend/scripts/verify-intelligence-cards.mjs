// Verification for intelligenceCards.ts - runs the exact scenarios from the
// bug report: legacy generic "Contextual Recommendation" recs must never land
// in PRODUCTS; rails must contain entities; dedupe by entity.
import {
  buildPastIntelligenceCards,
  entityDisplayName,
} from '../src/lib/intelligenceCards.ts';

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label} ${extra}`); }
}

// ── Scenario: legacy data (generic product rec titles) ──────────────────────
const events = [
  { id: 'ev1', eventType: 'ProductMentioned', entityName: 'Prodigy', confidence: 0.85, supportingTranscript: 'We shortlisted Prodigy for the field trials.', detectedAt: '2026-08-08T08:38:00Z' },
  { id: 'ev2', eventType: 'ProductMentioned', entityName: 'Apex 100', confidence: 0.88, supportingTranscript: 'Apex 100 came up again for the base tier.', detectedAt: '2026-08-08T09:04:00Z' },
  { id: 'ev3', eventType: 'ProductMentioned', entityName: 'Sprint 210', confidence: 0.95, supportingTranscript: 'Sprint 210 is the frontrunner for the rollout.', detectedAt: '2026-08-08T09:16:00Z' },
  { id: 'ev4', eventType: 'Objection', entityName: 'Third-party CT', confidence: 0.8, supportingTranscript: 'They had issues with third-party CT installation.', detectedAt: '2026-08-08T09:20:00Z' },
  { id: 'ev5', eventType: 'BuyingSignal', entityName: 'AMI requirements', confidence: 0.72, supportingTranscript: 'AMI requirements were re-stated by the buyer.', detectedAt: '2026-08-08T09:30:00Z' },
  { id: 'ev6', eventType: 'PricingDiscussion', entityName: null, confidence: 0.66, supportingTranscript: 'Budget for the mid tier was discussed.', detectedAt: '2026-08-08T09:40:00Z' },
];
const recommendations = [
  { id: 'r1', type: 'ProductMentioned', title: 'Contextual Recommendation', summary: 'Position Sprint 210 against rollout criteria.', talkingPoint: 'Lead with the rollout criteria match.', keyFacts: ['Two-way sync'], priority: 'high', confidence: 0.95, references: ['sprint-210-datasheet.pdf'], triggerEvent: 'ProductMentioned', provider: 'llm', model: 'configured', generatedAt: '2026-08-08T09:16:30Z' },
  { id: 'r2', type: 'ProductMentioned', title: 'Contextual Recommendation', summary: 'Apex 100 fits the base tier.', talkingPoint: null, keyFacts: [], priority: 'medium', confidence: 0.88, references: ['apex-100-whitepaper.pdf'], triggerEvent: 'ProductMentioned', provider: 'rule-based', model: 'fallback', generatedAt: '2026-08-08T09:04:30Z' },
  { id: 'r3', type: 'Objection', title: 'Addressing Third-party CT', summary: 'Reference the certified CT guide.', talkingPoint: 'Share the certified CT installation guide.', keyFacts: ['Certified CT list'], priority: 'medium', confidence: 0.8, references: ['ct-installation-guide.pdf'], triggerEvent: 'Objection', provider: 'llm', model: 'configured', generatedAt: '2026-08-08T09:20:30Z' },
];

console.log('entityDisplayName:');
check('ProductMentioned: Sprint 210 → Sprint 210', entityDisplayName('ProductMentioned: Sprint 210') === 'Sprint 210');
check('Objection: Third-party CT → Third-party CT', entityDisplayName('Objection: Third-party CT') === 'Third-party CT');
check('Addressing Third-party CT → Third-party CT', entityDisplayName('Addressing Third-party CT') === 'Third-party CT');
check('PricingDiscussion → PricingDiscussion (no prefix stripped)', entityDisplayName('PricingDiscussion') === 'PricingDiscussion');

const cards = buildPastIntelligenceCards(events, recommendations);
const byEntity = (c) => entityDisplayName(c.title).toLowerCase();

console.log('\nbuildPastIntelligenceCards with legacy generic recs:');
const productCards = cards.filter(c => c.type === 'product_match');
check('PRODUCTS has exactly 3 product cards (no generic duplicates)', productCards.length === 3, JSON.stringify(productCards.map(c => c.title)));
check('No "Contextual Recommendation" anywhere', !cards.some(c => c.title.includes('Contextual Recommendation')));
const entities = productCards.map(byEntity).sort();
check('Entities are Prodigy, Apex 100, Sprint 210', JSON.stringify(entities) === JSON.stringify(['apex 100', 'prodigy', 'sprint 210']), JSON.stringify(entities));
const sprint = productCards.find(c => byEntity(c) === 'sprint 210');
check('Sprint 210 card carries the recommendation intelligence (talking point)', sprint.body.includes('Lead with the rollout criteria match.'), JSON.stringify(sprint.body));
check('Sprint 210 card carries rec knowledge sources', sprint.chunks.includes('sprint-210-datasheet.pdf'), JSON.stringify(sprint.chunks));
check('Sprint 210 severity upgraded to high from rec priority', sprint.severity === 'high');
check('Apex 100 card merged its rec (body = Apex 100 fits the base tier)', productCards.find(c => byEntity(c) === 'apex 100').body.includes('Apex 100 fits the base tier.'));
const objection = cards.find(c => c.type === 'objection');
check('Objection card entity = Third-party CT', byEntity(objection) === 'third-party ct');
check('Objection rec intelligence merged', objection.body.includes('Share the certified CT installation guide.'));
const contextual = cards.find(c => c.type === 'buying_signal');
check('BuyingSignal → contextual card exists', !!contextual && byEntity(contextual) === 'ami requirements');

// New-style data: rec titles are entity names now (post server fix)
console.log('\nNew-style data (entity-titled recs):');
const newRecs = [
  { id: 'n1', type: 'ProductMentioned', title: 'Sprint 210', summary: 'Intelligence for Sprint 210.', talkingPoint: 'TP', keyFacts: [], priority: 'high', confidence: 0.9, references: ['s.pdf'], triggerEvent: 'ProductMentioned', provider: 'llm', model: 'm', generatedAt: '2026-08-08T09:16:30Z' },
];
const newCards = buildPastIntelligenceCards([events[2]], newRecs);
check('Product card title = entity (Sprint 210), not prefixed duplicate', newCards.length === 1 && entityDisplayName(newCards[0].title) === 'Sprint 210', JSON.stringify(newCards.map(c => ({ t: c.title, b: c.body.slice(0, 20) }))));
check('Dedupe: event + rec for same entity → one card with rec body', newCards.length === 1 && newCards[0].body.includes('TP') && !newCards[0].body.includes('Sprint 210 is the frontrunner'));

// Dedupe: repeated mentions
console.log('\nRepeated product mentions:');
const dupEvents = [events[2], { ...events[2], id: 'dup' }, { ...events[2], id: 'dup2' }];
const dupCards = buildPastIntelligenceCards(dupEvents, []);
check('Three mentions of Sprint 210 → one card', dupCards.length === 1);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
