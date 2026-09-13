import type { Language } from '@bitc/core';

/**
 * Customer-facing copy the system produces WITHOUT a model call — because the
 * model is unavailable, capped, or its reply was suppressed. Kept here rather
 * than inline so it can be reviewed as copy and overridden per tenant.
 *
 * Arabic strings are placeholders until the Phase 5 native review.
 */
export type SystemMessageKey =
  'escalated' | 'suppressed' | 'conversation_cap' | 'daily_cap' | 'error';

const MESSAGES: Record<Language, Record<SystemMessageKey, string>> = {
  en: {
    escalated: 'Thanks — I have passed this to the team, and someone will get back to you here.',
    suppressed:
      'I want to make sure I give you the right answer on this, so I have asked the team to reply to you directly.',
    conversation_cap:
      'This conversation has run long, so I have handed it to the team — someone will pick it up from here.',
    daily_cap:
      'Our assistant is taking a short break. Please leave your message and the team will reply.',
    error:
      'Something went wrong on our side. I have let the team know, and someone will follow up.',
  },
  ar: {
    escalated: 'شكراً لك، حوّلت طلبك للفريق وبيتواصلون معك هنا.',
    suppressed: 'أبغى أتأكد إني أعطيك الجواب الصحيح، فطلبت من الفريق يردون عليك مباشرة.',
    conversation_cap: 'المحادثة طوّلت، فحوّلتها للفريق وبيكملون معك من هنا.',
    daily_cap: 'المساعد في استراحة قصيرة. اترك رسالتك والفريق بيرد عليك.',
    error: 'صار خلل من عندنا. بلّغت الفريق وبيتواصلون معك.',
  },
};

export const systemMessage = (
  key: SystemMessageKey,
  lang: Language,
  overrides?: Partial<Record<Language, Partial<Record<SystemMessageKey, string>>>>,
): string => overrides?.[lang]?.[key] ?? MESSAGES[lang][key];

/**
 * The warning that must appear wherever a merchant edits the copy above.
 *
 * An override is returned to the customer verbatim. It never passes through
 * the model, so neither the literal gate nor the citation gate ever sees it —
 * this is the one customer-facing path in the system with no grounding check
 * on it at all.
 *
 * That is deliberate and it stays. A merchant's own words about their own
 * business are not ours to gate, and a system that silently rewrote them would
 * be worse than one that does not check them. What is NOT acceptable is the
 * person typing believing something checks it. The boundary is contractual,
 * not technical: it belongs in the licence agreement, and it belongs on the
 * screen where the typing happens.
 *
 * Defined here, beside the mechanism, so the wording cannot drift from what is
 * actually true of the code. The dashboard imports this rather than writing
 * its own — see test/merchant-copy.test.ts, which requires it.
 *
 * Arabic is a placeholder until the Phase 5 native review.
 */
export const MERCHANT_COPY_NOTICE: Record<Language, string> = {
  en:
    'You are writing this. It is sent to customers exactly as typed, in your own words, and ' +
    "nothing checks it. The assistant's accuracy rules apply only to answers it composes " +
    'itself. They do not apply here. If what you write is wrong, or goes out of date, it ' +
    'will still be sent.',
  ar:
    'هذا النص من كتابتك، ويوصل للعميل زي ما هو بالضبط، وما فيه شيء يتحقق منه. ' +
    'قواعد الدقة تنطبق فقط على الإجابات اللي يكتبها المساعد بنفسه، وما تنطبق هنا. ' +
    'إذا كان اللي كتبته غلط أو قديم، بيوصل للعميل مثل ما هو.',
};
