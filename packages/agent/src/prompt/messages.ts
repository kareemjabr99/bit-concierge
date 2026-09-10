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
