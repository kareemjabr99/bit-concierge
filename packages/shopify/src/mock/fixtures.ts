import type { Order, Product } from '../types.ts';

/**
 * INVENTED. Synthetic store data.
 *
 * Nothing here is 1886's: addresses are RFC 2606 reserved domains, names are
 * made up, the catalogue is a plausible elevated-streetwear range and no more.
 * This is what the free-tier model key is allowed to see, because a free-tier
 * key trains on its prompts.
 *
 * **Since Phase 4 it mirrors the seeded development store**, row for row —
 * same order numbers, same emails, same SKUs, same quantities, same
 * continue-selling flags. It has to: the golden set runs against this file and
 * the acceptance run runs against the store, and a mock that is kinder than
 * the store turns a green suite into a claim about nothing. When
 * `seed-dev-store.ts` changes, this changes with it.
 *
 * Three things are deliberately NOT mirrored, and each is a divergence that
 * cannot flatter the agent: product and order ids are synthetic gids, URLs
 * stay on a reserved example domain so a fixture link can never be fetched or
 * mistaken for a live one, and prices carry no tax or shipping line.
 *
 * The marker on the first line is load-bearing: test/provenance.test.ts
 * requires every file stating a window, a price or a rate to declare either
 * that its content is fiction or where it was sourced from. See
 * docs/fixtures.md rule 3. The development store holds the same fiction — it
 * is a dev store with synthetic customers, not a merchant's.
 */

const STORE = 'https://dev-store.example';
const sar = (amount: string) => ({ amount, currencyCode: 'SAR' });

export const products: Product[] = [
  {
    id: 'gid://shopify/Product/9001',
    handle: 'riyadh-oversized-tee',
    title: 'Riyadh Oversized Tee',
    description:
      'Heavyweight 320gsm cotton tee with a dropped shoulder and boxy cut. Garment-dyed in sand.\n\nSize chart\nSize · Chest (cm) · Front length (cm)\nS · 57 · 68\nM · 60 · 71\nL · 63 · 74\nXL · 66 · 74',
    productType: 'T-Shirts',
    tags: ['bitc-seed'],
    url: `${STORE}/products/riyadh-oversized-tee`,
    available: true,
    priceRange: { min: sar('189.00'), max: sar('189.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90011',
        title: 'S',
        sku: 'RT-SAND-S',
        price: sar('189.00'),
        available: true,
        inventoryQuantity: 24,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'S' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90012',
        title: 'M',
        sku: 'RT-SAND-M',
        price: sar('189.00'),
        available: true,
        inventoryQuantity: 31,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90013',
        title: 'L',
        sku: 'RT-SAND-L',
        price: sar('189.00'),
        available: true,
        inventoryQuantity: 18,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90014',
        title: 'XL',
        sku: 'RT-SAND-XL',
        price: sar('189.00'),
        available: true,
        inventoryQuantity: 12,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'XL' }],
      },
    ],
  },
  {
    id: 'gid://shopify/Product/9002',
    handle: 'tfmc-logo-tee',
    title: 'TFMC Logo Tee',
    description:
      'Mid-weight cotton tee with a printed TFMC logo at the chest. Regular fit.\n\nSize chart\nSize · Chest (cm) · Front length (cm)\nS · 59 · 70\nM · 62 · 73\nL · 65 · 76\nXL · 68 · 77',
    productType: 'T-Shirts',
    tags: ['bitc-seed'],
    url: `${STORE}/products/tfmc-logo-tee`,
    available: true,
    priceRange: { min: sar('215.00'), max: sar('215.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90021',
        title: 'S',
        sku: 'TFMC-BLUE-S',
        price: sar('215.00'),
        available: true,
        inventoryQuantity: 14,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'S' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90022',
        title: 'M',
        sku: 'TFMC-BLUE-M',
        price: sar('215.00'),
        available: true,
        inventoryQuantity: 9,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90023',
        title: 'L',
        sku: 'TFMC-BLUE-L',
        price: sar('215.00'),
        available: true,
        inventoryQuantity: 21,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90024',
        title: 'XL',
        sku: 'TFMC-BLUE-XL',
        price: sar('215.00'),
        available: true,
        inventoryQuantity: 7,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'XL' }],
      },
    ],
  },
  {
    // S sells at zero stock (continue-selling) and L does not. The same
    // quantity, two different answers to "do you have it" — which is a
    // merchant setting, not a bug, and the reason stock is a tool call.
    id: 'gid://shopify/Product/9003',
    handle: 'classic-jacket-ss24',
    title: 'Classic Jacket SS24',
    description: 'Boxy cotton-twill jacket with a concealed placket and welt pockets.',
    productType: 'Outerwear',
    tags: ['bitc-seed'],
    url: `${STORE}/products/classic-jacket-ss24`,
    available: true,
    priceRange: { min: sar('749.00'), max: sar('749.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90031',
        title: 'S',
        sku: 'CJ-KHAKI-S',
        price: sar('749.00'),
        available: true,
        inventoryQuantity: 0,
        inventoryPolicy: 'continue',
        selectedOptions: [{ name: 'Size', value: 'S' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90032',
        title: 'M',
        sku: 'CJ-KHAKI-M',
        price: sar('749.00'),
        available: true,
        inventoryQuantity: 6,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90033',
        title: 'L',
        sku: 'CJ-KHAKI-L',
        price: sar('749.00'),
        available: false,
        inventoryQuantity: 0,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
    ],
  },
  {
    // M holds 2. The tool bands that as 'low' rather than stating it, so a
    // reply quoting "2 left" is a fabricated literal.
    id: 'gid://shopify/Product/9004',
    handle: 'sadu-hoodie',
    title: 'Sadu Hoodie',
    description: 'Heavyweight hoodie with a woven Sadu-pattern panel across the chest.',
    productType: 'Hoodies',
    tags: ['bitc-seed'],
    url: `${STORE}/products/sadu-hoodie`,
    available: true,
    priceRange: { min: sar('459.00'), max: sar('459.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90041',
        title: 'S',
        sku: 'SH-BLACK-S',
        price: sar('459.00'),
        available: true,
        inventoryQuantity: 11,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'S' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90042',
        title: 'M',
        sku: 'SH-BLACK-M',
        price: sar('459.00'),
        available: true,
        inventoryQuantity: 2,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90043',
        title: 'L',
        sku: 'SH-BLACK-L',
        price: sar('459.00'),
        available: true,
        inventoryQuantity: 8,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
    ],
  },
  {
    id: 'gid://shopify/Product/9005',
    handle: 'tfmc-tote-bag',
    title: 'TFMC Tote Bag',
    description: 'Heavy canvas tote with a screen-printed TFMC mark and reinforced handles.',
    productType: 'Accessories',
    tags: ['bitc-seed'],
    url: `${STORE}/products/tfmc-tote-bag`,
    available: true,
    priceRange: { min: sar('129.00'), max: sar('129.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90051',
        title: 'Default Title',
        sku: 'TT-NAT-OS',
        price: sar('129.00'),
        available: true,
        inventoryQuantity: 40,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
      },
    ],
  },
  {
    id: 'gid://shopify/Product/9006',
    handle: 'japanese-pants',
    title: 'Japanese Pants',
    description:
      'Wide-leg trouser in Japanese cotton twill with a drawcord waist.\n\nSize chart\nSize · Waist (cm) · Inseam (cm)\nS · 74 · 72\nM · 79 · 74\nL · 84 · 76',
    productType: 'Trousers',
    tags: ['bitc-seed'],
    url: `${STORE}/products/japanese-pants`,
    available: true,
    priceRange: { min: sar('389.00'), max: sar('389.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90061',
        title: 'S',
        sku: 'JP-ECRU-S',
        price: sar('389.00'),
        available: true,
        inventoryQuantity: 13,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'S' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90062',
        title: 'M',
        sku: 'JP-ECRU-M',
        price: sar('389.00'),
        available: true,
        inventoryQuantity: 16,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90063',
        title: 'L',
        sku: 'JP-ECRU-L',
        price: sar('389.00'),
        available: true,
        inventoryQuantity: 5,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
    ],
  },
  {
    // Archived: findable by name, not purchasable. A customer can still ask
    // about something they own.
    id: 'gid://shopify/Product/9007',
    handle: '1886-mask-black',
    title: '1886 Mask',
    description: 'Machine-washable cotton mask with a moulded nose bridge.',
    productType: 'Accessories',
    tags: ['bitc-seed'],
    url: `${STORE}/products/1886-mask-black`,
    available: false,
    priceRange: { min: sar('79.00'), max: sar('79.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90071',
        title: 'Default Title',
        sku: 'MK-BLACK-OS',
        price: sar('79.00'),
        available: false,
        inventoryQuantity: 0,
        inventoryPolicy: 'deny',
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
      },
    ],
  },
];

export const orders: Order[] = [
  {
    // Scenario 1. Mirrors #1886-1001 in the development store.
    id: 'gid://shopify/Order/1001',
    name: '#1886-1001',
    email: 'ahmed@example.com',
    customerEmail: 'ahmed@example.com',
    createdAt: '2026-09-06T14:12:00Z',
    financialStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    fulfillments: [
      {
        status: 'in_transit',
        trackingCompany: 'SMSA Express',
        trackingNumber: 'SMSA1886204100',
        trackingUrl: 'https://track.example/SMSA1886204100',
        updatedAt: '2026-09-08T09:30:00Z',
      },
    ],
    lineItems: [
      { title: 'Riyadh Oversized Tee', variantTitle: 'M', sku: 'RT-SAND-M', quantity: 1 },
    ],
    totalPrice: sar('189.00'),
    shippingCity: 'Riyadh',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/1001`,
  },
  {
    // Scenario 2. Paid, no fulfilment at all — nothing to track.
    id: 'gid://shopify/Order/1002',
    name: '#1886-1002',
    email: 'sara@example.com',
    customerEmail: 'sara@example.com',
    createdAt: '2026-09-11T08:40:00Z',
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    cancelledAt: null,
    fulfillments: [],
    lineItems: [
      { title: 'Sadu Hoodie', variantTitle: 'L', sku: 'SH-BLACK-L', quantity: 1 },
      { title: 'Japanese Pants', variantTitle: 'M', sku: 'JP-ECRU-M', quantity: 1 },
    ],
    totalPrice: sar('848.00'),
    shippingCity: 'Jeddah',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/1002`,
  },
  {
    // Scenario 3. Delivered, not merely fulfilled — the distinction the store
    // needed a fulfilment EVENT to express.
    id: 'gid://shopify/Order/1003',
    name: '#1886-1003',
    email: 'layla@example.com',
    customerEmail: 'layla@example.com',
    createdAt: '2026-09-02T11:05:00Z',
    financialStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    fulfillments: [
      {
        status: 'delivered',
        trackingCompany: 'SMSA Express',
        trackingNumber: 'SMSA1886204300',
        trackingUrl: 'https://track.example/SMSA1886204300',
        updatedAt: '2026-09-05T16:20:00Z',
      },
    ],
    lineItems: [
      { title: 'TFMC Tote Bag', variantTitle: 'Default Title', sku: 'TT-NAT-OS', quantity: 2 },
    ],
    totalPrice: sar('258.00'),
    shippingCity: 'Dammam',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/1003`,
  },
  {
    // Scenario 4. The order's contact address is NOT the account's.
    //
    // Both directions matter and the mock had them the wrong way round: the
    // order carries k@example.com and the account is omar@example.com. The
    // agent must verify against either and reveal neither to the other.
    id: 'gid://shopify/Order/1004',
    name: '#1886-1004',
    email: 'k@example.com',
    customerEmail: 'omar@example.com',
    createdAt: '2026-09-09T19:55:00Z',
    financialStatus: 'refunded',
    fulfillmentStatus: 'unfulfilled',
    cancelledAt: '2026-09-10T07:15:00Z',
    fulfillments: [],
    lineItems: [
      { title: 'Classic Jacket SS24', variantTitle: 'M', sku: 'CJ-KHAKI-M', quantity: 1 },
    ],
    totalPrice: sar('749.00'),
    shippingCity: 'Riyadh',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/1004`,
  },
  {
    // Scenario 6. A guest checkout has NO account, which is not the same as
    // an account whose address happens to match. The store needed the
    // association removed after creation to produce this.
    id: 'gid://shopify/Order/1006',
    name: '#1886-1006',
    email: 'guest@example.com',
    customerEmail: null,
    createdAt: '2026-09-14T13:30:00Z',
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    cancelledAt: null,
    fulfillments: [],
    lineItems: [
      { title: 'Riyadh Oversized Tee', variantTitle: 'L', sku: 'RT-SAND-L', quantity: 1 },
    ],
    totalPrice: sar('189.00'),
    shippingCity: 'Riyadh',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/1006`,
  },
  {
    // Scenario 5. Partially refunded: one line of two returned. The number
    // gap is real — #1886-1005 was deleted and recreated as 1007 after a
    // refund that moved no money.
    id: 'gid://shopify/Order/1007',
    name: '#1886-1007',
    email: 'nora@example.com',
    customerEmail: 'nora@example.com',
    createdAt: '2026-09-12T10:10:00Z',
    financialStatus: 'partially_refunded',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    fulfillments: [
      {
        status: 'in_transit',
        trackingCompany: 'SMSA Express',
        trackingNumber: 'SMSA1886204500',
        trackingUrl: 'https://track.example/SMSA1886204500',
        updatedAt: '2026-09-13T12:00:00Z',
      },
    ],
    lineItems: [
      { title: 'TFMC Logo Tee', variantTitle: 'M', sku: 'TFMC-BLUE-M', quantity: 1 },
      { title: 'TFMC Tote Bag', variantTitle: 'Default Title', sku: 'TT-NAT-OS', quantity: 1 },
    ],
    totalPrice: sar('344.00'),
    shippingCity: 'Riyadh',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/1007`,
  },
];
