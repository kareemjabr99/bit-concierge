# Phase 3 demo script

What to show, in what order, and what is deliberately not shown.

## Setup

```bash
pnpm db:migrate && pnpm db:seed
pnpm --filter @bitc/rag ingest -- --clean corpus/1886/clean --clean-only
pnpm --filter @bitc/widget build
pnpm --filter @bitc/web dev
```

Then open `http://localhost:8787/demo`. That page styles every element badly on
purpose — Comic Sans, red dotted borders — so the shadow boundary is visible
rather than asserted.

## The five minutes

**1. The widget is unaffected by the page around it.** The launcher is dark,
system-font and rounded on a page that is red and dotted. A merchant's theme is
other people's code in the same document; neither side reaches the other.

**2. Ask "how long do I have to return something?"** Watch the stages:
_Working on it → Checking the store's policies_. Then the answer, whole, with a
citation link to the refund policy.

Say what the stages are: **the actual tools the agent called, announced as each
one starts.** Not a progress bar. If it says it is checking your order, it
called the order lookup.

**3. Say why the answer arrives whole rather than typed.** This is the question
a client who has seen a competitor will ask, and the answer is the product —
see `docs/adr/0010-no-streaming.md`. The short version: the reply can be
withheld, and a stream cannot be un-sent. A competitor that types word by word
is telling you nothing inspects the finished answer.

**4. Ask something the corpus does not answer** — "do you offer gift
wrapping?". It hands over rather than guessing. Then ask again in the same
conversation: _"The team has this one and will reply here."_ The agent stops
answering, not speaking.

**5. Show the bar, not a percentage.** Zero fabricated literals and zero
uncited claims reaching a customer, across six full runs. Then say the second
half out loud: **that is a safety guarantee, not a quality guarantee.**
Deflection is what shows it is worth paying for, and it is measured against a
suite 1886 has not signed yet.

## What NOT to claim

- Not "95% accurate". That bar is retired; ADR 0011 says why.
- Not "it answers most questions". It answered 54% of a drafted suite against a
  corpus with no FAQ and nothing published on payment methods, opening hours,
  care instructions or sizing guidance.
- Not "connected to your store". Orders, products and stock are synthetic
  fixtures until Phase 4.
- Not "works in Arabic". The retrieval path does; the copy is placeholder text
  with no native review until Phase 5.

---

## Open items — must close before the Phase 3 gate

### Mobile interaction, on a real phone

**Status: NOT VERIFIED.** This is the item to take seriously — KSA storefront
traffic is roughly 78% mobile, so a phone is the common case and not an edge
one.

What _is_ verified: the layout at 375 and 390 px wide, and, since 2026-09-16,
the tap targets. Every control now carries `min-height: 44px` and the input is
16px so Safari does not zoom the merchant's page when someone taps it. Both are
enforced by `test/widget-isolation.test.ts`.

That check found a real defect that a desktop screenshot had hidden: **the
close button was a 29px target.** It looked fine on a laptop and would have
been unpleasant to hit on a phone — which is exactly why "it renders correctly
at mobile width" is not the same as "it works on a phone".

What is _not_ verified is a finger on glass: real touch events, scroll
behaviour inside the panel, the on-screen keyboard resizing the viewport under
the input, and momentum scrolling in the transcript. The in-app browser could
not drive it — its pane must be visible for pointer events to dispatch, and it
was not.

**To close it:**

```bash
pnpm --filter @bitc/web dev
# then expose 8787 over a tunnel and open it on the phone
```

The seeded tenant already allows `http://localhost:8787`; a tunnel serves a
different origin, so add it first:

```sql
UPDATE tenant_config
SET widget_origins = widget_origins || ARRAY['https://<your-tunnel-host>']
WHERE tenant_id = (SELECT id FROM tenants WHERE widget_public_key = 'pk_dev_1886');
```

Check specifically: the launcher and close button are comfortable one-handed,
the keyboard does not cover the input, the transcript scrolls without dragging
the page behind it, and the stages are readable while they change.

**Remove the tunnel origin afterwards.** An origin left in that list is a
standing permission for a host nobody controls any more.
