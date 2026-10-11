import type { ToolCallRecord } from '../context.ts';

/**
 * Look before handing over.
 *
 * The model escalated questions it had never tried to answer — a hand-over
 * with no search behind it is a question the store's own pages may answer,
 * sent to a person anyway. The prompt already said to search first and the
 * model did not always do it, so the rule lives here: `escalate_to_human` is
 * refused until a search or lookup tool has run earlier in the same turn.
 *
 * What counts as having looked is any call to one of LOOKUP_TOOLS, whatever it
 * returned. A search that found nothing is the strongest reason there is to
 * escalate — "do you sell shoes" searches, finds nothing, and hands over.
 *
 * Two exemptions, and no others:
 *
 * - The customer asked for a person, in their own words this turn. Read from
 *   the customer's text, not from the reason the model gives: a reason is the
 *   model's own label, and a gate the model can open by choosing a label is
 *   not a gate. Patterns are English and a starting set of Gulf Arabic; Arabic
 *   is unvalidated until Phase 5. A phrasing they miss costs one refusal, not
 *   the hand-over — see the cap below.
 * - The reasons the system prompt says to escalate immediately, without an
 *   attempt to resolve. There is one: `complaint` ("angry, distressed, or has
 *   a complaint about a person, escalate immediately"). This one IS the
 *   model's label; anger is not something a pattern reads reliably, and a
 *   furious customer told to wait while the assistant searches is the failure
 *   this exemption exists to prevent.
 *
 * The escalations the loop makes itself — caps, tool failure, step limit, the
 * grounding gate, an outstanding payment — call `escalate()` directly and
 * never pass through this check.
 *
 * And a cap. A model that insists after MAX_ESCALATION_REFUSALS refusals is
 * let through: this rule exists to make it look first, and a turn that ends in
 * a step-limit escalation because the model and the gate argued until the
 * budget ran out would be the same hand-over, later and with a worse reason.
 */

/** Tools that count as having looked. Everything except the hand-over itself. */
export const LOOKUP_TOOLS: ReadonlySet<string> = new Set([
  'search_knowledge',
  'lookup_order',
  'search_products',
  'check_availability',
  'get_shipping_estimate',
]);

/** Reasons the system prompt escalates immediately. From system.txt; add none here without it. */
export const IMMEDIATE_ESCALATION_REASONS: ReadonlySet<string> = new Set(['complaint']);

/** Refusals per turn before an insistent escalation is let through. */
export const MAX_ESCALATION_REFUSALS = 1;

export const SEARCH_FIRST_CODE = 'search_first';

const PERSON =
  /\b(?:a |an |the |to |with |your )?(?:human|real person|person|someone|somebody|agent|representative|rep|manager|supervisor|staff|team|customer (?:service|support|care)|support team|operator|employee)\b/i;
const ASK =
  /\b(?:talk|speak|chat|connect|contact|transfer|put me through|get me|let me|can i (?:get|have)|i (?:want|need|would like|'d like)|is there|reach)\b/i;
const ARABIC_PERSON = /(?:موظف|شخص|انسان|إنسان|بشري|خدمة العملاء|المسؤول|مسؤول|الدعم)/;

/** True when the customer, in this turn's message, asks for a person. */
export const asksForHuman = (customerText: string): boolean => {
  if (ARABIC_PERSON.test(customerText)) return true;
  if (/\b(?:human|real person|live agent|customer (?:service|support|care))\b/i.test(customerText))
    return true;
  return PERSON.test(customerText) && ASK.test(customerText);
};

export type EscalationOrderVerdict =
  | { allow: true; why: 'looked' | 'asked_for_human' | 'immediate_reason' | 'refusal_cap' }
  | { allow: false };

export const checkEscalationOrder = (input: {
  reason: string;
  customerText: string;
  toolCalls: readonly ToolCallRecord[];
}): EscalationOrderVerdict => {
  if (input.toolCalls.some((t) => LOOKUP_TOOLS.has(t.name))) return { allow: true, why: 'looked' };
  if (asksForHuman(input.customerText)) return { allow: true, why: 'asked_for_human' };
  if (IMMEDIATE_ESCALATION_REASONS.has(input.reason))
    return { allow: true, why: 'immediate_reason' };
  const refusals = input.toolCalls.filter(
    (t) =>
      t.name === 'escalate_to_human' &&
      (t.output as { error?: { code?: string } }).error?.code === SEARCH_FIRST_CODE,
  ).length;
  if (refusals >= MAX_ESCALATION_REFUSALS) return { allow: true, why: 'refusal_cap' };
  return { allow: false };
};
