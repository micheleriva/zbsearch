import type { PinRule } from 'zbsearch'

export interface MerchandisingRule {
  rule: PinRule
  /** Human readable name shown in the merchandising panel. */
  label: string
  /** What a merchandiser would be trying to achieve with this rule. */
  rationale: string
  /** A query that triggers the rule, used by the "try it" buttons. */
  sample: string
}

/**
 * The merchandising rules the demo ships with.
 *
 * Every one of them is a plain ZBSearch `PinRule`: `conditions` decide when the rule
 * fires (all of them have to match), `consequence.promote` decides which document
 * lands on which zero-based position.
 */
export const merchandisingRules: MerchandisingRule[] = [
  {
    label: 'Gift guide',
    rationale:
      'No product in the catalog describes itself as a gift, so relevance alone has nothing to rank. The rule turns a dead end into a curated, three-product landing page.',
    sample: 'gift',
    rule: {
      id: 'gift_guide',
      conditions: [{ anchoring: 'contains', pattern: 'gift' }],
      consequence: {
        promote: [
          { doc_id: '7', position: 0 },
          { doc_id: '193', position: 1 },
          { doc_id: '182', position: 2 },
        ],
      },
    },
  },
  {
    label: 'Laptop hero',
    rationale:
      'Relevance alone puts the two products with "Laptop" in the title first. The rule overrides that and puts the flagship MacBook on top, without hiding anything else.',
    sample: 'laptop',
    rule: {
      id: 'laptop_hero',
      conditions: [{ anchoring: 'contains', pattern: 'laptop' }],
      consequence: {
        promote: [{ doc_id: '78', position: 0 }],
      },
    },
  },
  {
    label: 'iPhone upsell',
    rationale:
      'Uses `starts_with` anchoring, so it only fires when the query opens with "iphone" — pushing the current generation ahead of the older models and the accessories.',
    sample: 'iphone',
    rule: {
      id: 'iphone_upsell',
      conditions: [{ anchoring: 'starts_with', pattern: 'iphone' }],
      consequence: {
        promote: [{ doc_id: '123', position: 0 }],
      },
    },
  },
  {
    label: 'Luxury watches',
    rationale:
      'Two conditions, implicitly ANDed: the query has to mention both "luxury" and "watch" before the two highest-margin Rolexes take the top slots.',
    sample: 'luxury watch',
    rule: {
      id: 'luxury_watches',
      conditions: [
        { anchoring: 'contains', pattern: 'luxury' },
        { anchoring: 'contains', pattern: 'watch' },
      ],
      consequence: {
        promote: [
          { doc_id: '98', position: 0 },
          { doc_id: '97', position: 1 },
        ],
      },
    },
  },
]

/**
 * The same matching logic ZBSearch applies internally, replicated here so the UI can
 * tell you which rule fired and why without reaching into the engine.
 */
export function ruleMatches(rule: PinRule, term: string): boolean {
  const normalized = term.toLowerCase().trim()

  if (normalized === '') {
    return false
  }

  return rule.conditions.every(condition => {
    const pattern = condition.pattern.toLowerCase().trim()

    switch (condition.anchoring) {
      case 'is':
        return normalized === pattern
      case 'starts_with':
        return normalized.startsWith(pattern)
      case 'contains':
        return normalized.includes(pattern)
      default:
        return false
    }
  })
}
