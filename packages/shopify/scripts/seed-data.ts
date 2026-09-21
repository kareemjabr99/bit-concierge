/**
 * What the development store is seeded with: prices, measurements, stock
 * levels, customers and the six order scenarios.
 *
 * Separated from the script that writes it because a second reader needs it —
 * `test/mock-mirrors-store.test.ts` holds the mock fixtures to these values.
 * The mock and the store diverged once already, silently, in the direction
 * that matters: the mock made a guest order out of a customer's and reversed
 * the two emails on the different-email scenario, so sixteen golden-set cases
 * would have passed against a store that behaves differently. A comment
 * saying "keep these in step" is the kind of rule that gets held wrong; a
 * failing test is not.
 *
 * Data only. Nothing here talks to the network.
 */

// ---------------------------------------------------------------------------
// Prices and measurements.
//
// Chosen here rather than in the store, because the literal gate checks every
// number in a reply against what the tools returned: a price that differs
// between the store and this file produces a suppression that looks like a bug
// and is not. docs/fixtures.md rule 2 — this is configuration reaching a
// customer, so it is sourced or it is absent, and this file is the source.
// ---------------------------------------------------------------------------

export const SAR = (amount: string) => amount;

export interface SeedVariant {
  option: string;
  sku: string;
  price: string;
  quantity: number;
  /** DENY stops overselling; CONTINUE is the state that looks available and is not. */
  policy: 'DENY' | 'CONTINUE';
}

export interface SeedProduct {
  handle: string;
  title: string;
  description: string;
  productType: string;
  optionName: string;
  variants: SeedVariant[];
  status: 'ACTIVE' | 'ARCHIVED';
  /** Rendered into the description so retrieval and the tool agree. */
  sizeChart?: { header: string[]; rows: string[][] };
}

export const PRODUCTS: SeedProduct[] = [
  {
    handle: 'riyadh-oversized-tee',
    title: 'Riyadh Oversized Tee',
    description:
      'Heavyweight 320gsm cotton tee with a dropped shoulder and boxy cut. Garment-dyed in sand.',
    productType: 'T-Shirts',
    optionName: 'Size',
    status: 'ACTIVE',
    // Chest 63 at L here; the second tee below says 65. Two different correct
    // answers is the point — sizing-tee-chest exists because the agent must say
    // measurements vary by style rather than pick one.
    sizeChart: {
      header: ['Size', 'Chest (cm)', 'Front length (cm)'],
      rows: [
        ['S', '57', '68'],
        ['M', '60', '71'],
        ['L', '63', '74'],
        ['XL', '66', '74'],
      ],
    },
    variants: [
      { option: 'S', sku: 'RT-SAND-S', price: SAR('189.00'), quantity: 24, policy: 'DENY' },
      { option: 'M', sku: 'RT-SAND-M', price: SAR('189.00'), quantity: 31, policy: 'DENY' },
      { option: 'L', sku: 'RT-SAND-L', price: SAR('189.00'), quantity: 18, policy: 'DENY' },
      { option: 'XL', sku: 'RT-SAND-XL', price: SAR('189.00'), quantity: 12, policy: 'DENY' },
    ],
  },
  {
    handle: 'tfmc-logo-tee',
    title: 'TFMC Logo Tee',
    description: 'Mid-weight cotton tee with a printed TFMC logo at the chest. Regular fit.',
    productType: 'T-Shirts',
    optionName: 'Size',
    status: 'ACTIVE',
    sizeChart: {
      header: ['Size', 'Chest (cm)', 'Front length (cm)'],
      rows: [
        ['S', '59', '70'],
        ['M', '62', '73'],
        ['L', '65', '76'],
        ['XL', '68', '77'],
      ],
    },
    variants: [
      { option: 'S', sku: 'TFMC-BLUE-S', price: SAR('215.00'), quantity: 14, policy: 'DENY' },
      { option: 'M', sku: 'TFMC-BLUE-M', price: SAR('215.00'), quantity: 9, policy: 'DENY' },
      { option: 'L', sku: 'TFMC-BLUE-L', price: SAR('215.00'), quantity: 21, policy: 'DENY' },
      { option: 'XL', sku: 'TFMC-BLUE-XL', price: SAR('215.00'), quantity: 7, policy: 'DENY' },
    ],
  },
  {
    handle: 'classic-jacket-ss24',
    title: 'Classic Jacket SS24',
    description: 'Boxy cotton-twill jacket with a concealed placket and welt pockets.',
    productType: 'Outerwear',
    optionName: 'Size',
    status: 'ACTIVE',
    variants: [
      // S: zero but still selling. The state that LOOKS available and is not —
      // the one worth finding in Phase 4 rather than in front of a merchant.
      { option: 'S', sku: 'CJ-KHAKI-S', price: SAR('749.00'), quantity: 0, policy: 'CONTINUE' },
      { option: 'M', sku: 'CJ-KHAKI-M', price: SAR('749.00'), quantity: 6, policy: 'DENY' },
      // L: a genuine out-of-stock.
      { option: 'L', sku: 'CJ-KHAKI-L', price: SAR('749.00'), quantity: 0, policy: 'DENY' },
    ],
  },
  {
    handle: 'sadu-hoodie',
    title: 'Sadu Hoodie',
    description: 'Heavyweight hoodie with a woven Sadu-pattern panel across the chest.',
    productType: 'Hoodies',
    optionName: 'Size',
    status: 'ACTIVE',
    variants: [
      { option: 'S', sku: 'SH-BLACK-S', price: SAR('459.00'), quantity: 11, policy: 'DENY' },
      // Low stock. The agent must not editorialise — no "hurry", no "only 2 left!".
      { option: 'M', sku: 'SH-BLACK-M', price: SAR('459.00'), quantity: 2, policy: 'DENY' },
      { option: 'L', sku: 'SH-BLACK-L', price: SAR('459.00'), quantity: 8, policy: 'DENY' },
    ],
  },
  {
    handle: 'tfmc-tote-bag',
    title: 'TFMC Tote Bag',
    // Deliberately NO size chart: sizing-no-chart-for-product asks for its
    // measurements and the honest answer is a hand-over.
    description: 'Heavy canvas tote with a screen-printed TFMC mark and reinforced handles.',
    productType: 'Accessories',
    optionName: 'Title',
    status: 'ACTIVE',
    variants: [
      {
        option: 'Default Title',
        sku: 'TT-NAT-OS',
        price: SAR('129.00'),
        quantity: 40,
        policy: 'DENY',
      },
    ],
  },
  {
    handle: 'japanese-pants',
    title: 'Japanese Pants',
    description: 'Wide-leg trouser in Japanese cotton twill with a drawcord waist.',
    productType: 'Trousers',
    optionName: 'Size',
    status: 'ACTIVE',
    sizeChart: {
      header: ['Size', 'Waist (cm)', 'Inseam (cm)'],
      rows: [
        ['S', '74', '72'],
        ['M', '79', '74'],
        ['L', '84', '76'],
      ],
    },
    variants: [
      { option: 'S', sku: 'JP-ECRU-S', price: SAR('389.00'), quantity: 13, policy: 'DENY' },
      { option: 'M', sku: 'JP-ECRU-M', price: SAR('389.00'), quantity: 16, policy: 'DENY' },
      { option: 'L', sku: 'JP-ECRU-L', price: SAR('389.00'), quantity: 5, policy: 'DENY' },
    ],
  },
  {
    handle: '1886-mask-black',
    title: '1886 Mask',
    description: 'Machine-washable cotton mask with a moulded nose bridge.',
    productType: 'Accessories',
    optionName: 'Title',
    // Archived: reachable by name, not purchasable. A customer can still ask.
    status: 'ARCHIVED',
    variants: [
      {
        option: 'Default Title',
        sku: 'MK-BLACK-OS',
        price: SAR('79.00'),
        quantity: 0,
        policy: 'DENY',
      },
    ],
  },
];

export const CUSTOMERS = [
  { email: 'ahmed@example.com', firstName: 'Ahmed', lastName: 'Example', city: 'Riyadh' },
  { email: 'sara@example.com', firstName: 'Sara', lastName: 'Example', city: 'Jeddah' },
  { email: 'layla@example.com', firstName: 'Layla', lastName: 'Example', city: 'Dammam' },
  { email: 'omar@example.com', firstName: 'Omar', lastName: 'Example', city: 'Riyadh' },
  { email: 'nora@example.com', firstName: 'Nora', lastName: 'Example', city: 'Riyadh' },
] as const;

export interface SeedOrder {
  key: string;
  scenario: string;
  /** Null for the guest-checkout case: no linked customer record. */
  customerEmail: string | null;
  /** The email ON THE ORDER. Differs from the account on scenario 4. */
  orderEmail: string;
  city: string;
  lines: { sku: string; quantity: number }[];
  fulfil: null | { trackingNumber: string; company: string; url: string; delivered: boolean };
  cancel: boolean;
  refundSku: string | null;
}

export const ORDERS: SeedOrder[] = [
  {
    key: 'order-1-in-transit',
    scenario: '1. Happy path, in transit',
    customerEmail: 'ahmed@example.com',
    orderEmail: 'ahmed@example.com',
    city: 'Riyadh',
    lines: [{ sku: 'RT-SAND-M', quantity: 1 }],
    fulfil: {
      trackingNumber: 'SMSA1886204100',
      company: 'SMSA Express',
      url: 'https://track.example/SMSA1886204100',
      delivered: false,
    },
    cancel: false,
    refundSku: null,
  },
  {
    key: 'order-2-unshipped',
    scenario: '2. Paid but unshipped',
    customerEmail: 'sara@example.com',
    orderEmail: 'sara@example.com',
    city: 'Jeddah',
    lines: [
      { sku: 'SH-BLACK-L', quantity: 1 },
      { sku: 'JP-ECRU-M', quantity: 1 },
    ],
    fulfil: null,
    cancel: false,
    refundSku: null,
  },
  {
    key: 'order-3-delivered',
    scenario: '3. Delivered',
    customerEmail: 'layla@example.com',
    orderEmail: 'layla@example.com',
    city: 'Dammam',
    lines: [{ sku: 'TT-NAT-OS', quantity: 2 }],
    fulfil: {
      trackingNumber: 'SMSA1886204300',
      company: 'SMSA Express',
      url: 'https://track.example/SMSA1886204300',
      delivered: true,
    },
    cancel: false,
    refundSku: null,
  },
  {
    key: 'order-4-different-email',
    // The one most easily got wrong by hand. The account is omar@; the order
    // carries k@. The agent must verify against EITHER and must not reveal
    // that the other exists.
    scenario: '4. Cancelled, different email on the order',
    customerEmail: 'omar@example.com',
    orderEmail: 'k@example.com',
    city: 'Riyadh',
    lines: [{ sku: 'CJ-KHAKI-M', quantity: 1 }],
    fulfil: null,
    cancel: true,
    refundSku: null,
  },
  {
    key: 'order-5-partial-refund',
    scenario: '5. Partially refunded',
    customerEmail: 'nora@example.com',
    orderEmail: 'nora@example.com',
    city: 'Riyadh',
    lines: [
      { sku: 'TFMC-BLUE-M', quantity: 1 },
      { sku: 'TT-NAT-OS', quantity: 1 },
    ],
    fulfil: {
      trackingNumber: 'SMSA1886204500',
      company: 'SMSA Express',
      url: 'https://track.example/SMSA1886204500',
      delivered: false,
    },
    cancel: false,
    refundSku: 'TT-NAT-OS',
  },
  {
    key: 'order-6-guest',
    // No customer record at all: customerEmail null. Exercises the identity
    // gate against `customer === null` with `email` present, which is how a
    // guest checkout actually looks and is not something the mock produced.
    scenario: '6. Guest checkout, no customer record',
    customerEmail: null,
    orderEmail: 'guest@example.com',
    city: 'Riyadh',
    lines: [{ sku: 'RT-SAND-L', quantity: 1 }],
    fulfil: null,
    cancel: false,
    refundSku: null,
  },
];

/** The description as the store holds it: the copy, plus the chart if there is one. */
export const describeProduct = (p: SeedProduct): string => {
  if (!p.sizeChart) return p.description;
  const rows = p.sizeChart.rows.map((r) => r.join(' · ')).join('\n');
  return `${p.description}\n\nSize chart\n${p.sizeChart.header.join(' · ')}\n${rows}`;
};

/**
 * The order numbers the store actually assigned, read back from it on
 * 2026-09-21.
 *
 * Shopify assigns these sequentially and `name` is read-only through the Admin
 * API, so they are discovered, never chosen. The gap is real: #1886-1005 was
 * created by a refund attempt that moved no money, deleted, and recreated as
 * #1886-1007 — which is why the partial-refund scenario has a HIGHER number
 * than the guest one and a positional mapping would be wrong.
 *
 * Recorded here because the golden set and the mock fixtures both hard-code
 * these strings. If a future store assigns different numbers, the seed script
 * says so on its readback instead of leaving two files quietly wrong.
 */
export const ASSIGNED_ORDER_NUMBERS: Record<string, string> = {
  'order-1-in-transit': '#1886-1001',
  'order-2-unshipped': '#1886-1002',
  'order-3-delivered': '#1886-1003',
  'order-4-different-email': '#1886-1004',
  'order-5-partial-refund': '#1886-1007',
  'order-6-guest': '#1886-1006',
};
