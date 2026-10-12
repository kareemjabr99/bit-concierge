import { checkCitations, sourcesFromToolCalls, type CitationVerdict } from './citations.ts';
import { checkGrounding, type GroundingVerdict } from './grounding.ts';

export interface GateInput {
  /** The model's text, citation markers and all. */
  text: string;
  /** Every tool call this turn, in order. */
  toolCalls: { name: string; output: unknown }[];
  /** What the customer wrote this turn. */
  customerText: string;
  brandName: string;
}

export interface GateVerdict {
  ok: boolean;
  literal: GroundingVerdict;
  citations: CitationVerdict;
}

/**
 * Both halves of the deterministic gate, as the loop runs them. ADR 0005.
 *
 * One function so that the loop and the offline re-scorer cannot disagree
 * about what the gate is: a re-score that assembled its own copy of these two
 * calls would measure the copy.
 */
export const gateReply = ({ text, toolCalls, customerText, brandName }: GateInput): GateVerdict => {
  const literal = checkGrounding({
    reply: text,
    toolResults: toolCalls.map((t) => t.output),
    toolsCalled: toolCalls.map((t) => t.name),
    alwaysGrounded: [brandName],
  });
  const citations = checkCitations({
    reply: text,
    sources: sourcesFromToolCalls(toolCalls),
    customerText,
  });
  return { ok: literal.ok && citations.ok, literal, citations };
};
