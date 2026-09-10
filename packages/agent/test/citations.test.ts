import { describe, expect, it } from 'vitest';
import { checkCitations, stripCitations } from '../src/index.ts';

const retrieved = ['fx-returns-window', 'fx-shipping-ksa'];

describe('grounding gate — policy citations', () => {
  it('passes policy sentences that cite a retrieved chunk, and strips the markers', () => {
    const v = checkCitations({
      reply:
        'You can return within 14 days of delivery. [[c:fx-returns-window]] Shipping inside Saudi is free over 300 SAR. [[c:fx-shipping-ksa]]',
      retrievedChunkIds: retrieved,
      searchCalled: true,
      otherToolResults: [],
    });
    expect(v.ok).toBe(true);
    expect(v.cited).toEqual(retrieved);
    expect(v.cleanReply).toBe(
      'You can return within 14 days of delivery. Shipping inside Saudi is free over 300 SAR.',
    );
  });

  it('accepts the marker on either side of the full stop', () => {
    for (const reply of [
      'Exchanges are free within Saudi Arabia. [[c:fx-shipping-ksa]]',
      'Exchanges are free within Saudi Arabia [[c:fx-shipping-ksa]].',
      'Exchanges are free within Saudi Arabia.[[c:fx-shipping-ksa]]',
    ]) {
      const v = checkCitations({
        reply,
        retrievedChunkIds: retrieved,
        searchCalled: true,
        otherToolResults: [],
      });
      expect(v.ok, reply).toBe(true);
      expect(v.cleanReply).toBe('Exchanges are free within Saudi Arabia.');
    }
  });

  it('fails a policy sentence with no marker', () => {
    const v = checkCitations({
      reply: 'You can return within 30 days.',
      retrievedChunkIds: retrieved,
      searchCalled: true,
      otherToolResults: [],
    });
    expect(v.ok).toBe(false);
    expect(v.misses[0]?.reason).toBe('no_marker');
  });

  it('fails a marker that points at a chunk retrieval never returned', () => {
    const v = checkCitations({
      reply: 'Exchanges are free. [[c:made-up]]',
      retrievedChunkIds: retrieved,
      searchCalled: true,
      otherToolResults: [],
    });
    expect(v.ok).toBe(false);
    expect(v.misses[0]).toMatchObject({ reason: 'unknown_chunk', chunkId: 'made-up' });
  });

  it('fails a policy claim when retrieval was never called', () => {
    const v = checkCitations({
      reply: 'Refunds take 5 business days.',
      retrievedChunkIds: [],
      searchCalled: false,
      otherToolResults: [],
    });
    expect(v.ok).toBe(false);
    expect(v.misses[0]?.reason).toBe('no_retrieval');
  });

  it('exempts an order fact grounded in another tool', () => {
    const v = checkCitations({
      reply: 'Your order #1886-2041 shipped and is on its way.',
      retrievedChunkIds: [],
      searchCalled: false,
      otherToolResults: [{ ok: true, order: { number: '#1886-2041' } }],
    });
    expect(v.ok).toBe(true);
  });

  it('exempts questions and plain conversation', () => {
    const v = checkCitations({
      reply: 'Happy to help. Which size did you order? I can check the fit for you.',
      retrievedChunkIds: [],
      searchCalled: false,
      otherToolResults: [],
    });
    expect(v.ok).toBe(true);
  });

  it('handles Arabic policy sentences and the Arabic question mark', () => {
    const v = checkCitations({
      reply:
        'تقدر ترجع المنتج خلال 14 يوم من الاستلام. [[c:fx-returns-window]] تبغى أساعدك بشي ثاني؟',
      retrievedChunkIds: retrieved,
      searchCalled: true,
      otherToolResults: [],
    });
    expect(v.ok).toBe(true);
    expect(stripCitations(v.cleanReply)).not.toContain('[[');
  });
});
