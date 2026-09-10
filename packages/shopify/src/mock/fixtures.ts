import type { Order, Product } from '../types.ts';

/**
 * Synthetic store data for Phase 1–3. Nothing here is real: addresses are
 * RFC 2606 reserved domains, names are invented, the catalogue is a plausible
 * elevated-streetwear range and no more. This is what the free-tier model key
 * is allowed to see. Phase 4 seeds the development store from the same shapes.
 */

const STORE = 'https://dev-store.example';
const sar = (amount: string) => ({ amount, currencyCode: 'SAR' });

export const products: Product[] = [
  {
    id: 'gid://shopify/Product/9001',
    handle: 'riyadh-oversized-tee',
    title: 'Riyadh Oversized Tee',
    description:
      'Heavyweight 320gsm cotton tee with a dropped shoulder and boxy cut. Garment-dyed in sand. Runs one size large — size down for a regular fit.',
    productType: 'T-Shirts',
    tags: ['tee', 'oversized', 'cotton', 'sand', 'new'],
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
        inventoryQuantity: 12,
        selectedOptions: [{ name: 'Size', value: 'S' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90012',
        title: 'M',
        sku: 'RT-SAND-M',
        price: sar('189.00'),
        available: true,
        inventoryQuantity: 7,
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90013',
        title: 'L',
        sku: 'RT-SAND-L',
        price: sar('189.00'),
        available: true,
        inventoryQuantity: 3,
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90014',
        title: 'XL',
        sku: 'RT-SAND-XL',
        price: sar('189.00'),
        available: false,
        inventoryQuantity: 0,
        selectedOptions: [{ name: 'Size', value: 'XL' }],
      },
    ],
  },
  {
    id: 'gid://shopify/Product/9002',
    handle: 'najd-cargo-pant',
    title: 'Najd Cargo Pant',
    description:
      'Relaxed straight-leg cargo in ripstop cotton with six pockets and an adjustable hem. Mid-rise. True to size.',
    productType: 'Trousers',
    tags: ['cargo', 'pant', 'ripstop', 'olive'],
    url: `${STORE}/products/najd-cargo-pant`,
    available: true,
    priceRange: { min: sar('349.00'), max: sar('349.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90021',
        title: '30',
        sku: 'NC-OLV-30',
        price: sar('349.00'),
        available: true,
        inventoryQuantity: 5,
        selectedOptions: [{ name: 'Waist', value: '30' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90022',
        title: '32',
        sku: 'NC-OLV-32',
        price: sar('349.00'),
        available: true,
        inventoryQuantity: 9,
        selectedOptions: [{ name: 'Waist', value: '32' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90023',
        title: '34',
        sku: 'NC-OLV-34',
        price: sar('349.00'),
        available: true,
        inventoryQuantity: 4,
        selectedOptions: [{ name: 'Waist', value: '34' }],
      },
    ],
  },
  {
    id: 'gid://shopify/Product/9003',
    handle: 'sadu-hoodie',
    title: 'Sadu Hoodie',
    description:
      'Brushed-back fleece hoodie with Sadu-inspired jacquard panel across the chest. Oversized. Limited run.',
    productType: 'Hoodies',
    tags: ['hoodie', 'fleece', 'sadu', 'limited'],
    url: `${STORE}/products/sadu-hoodie`,
    available: false,
    priceRange: { min: sar('429.00'), max: sar('429.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90031',
        title: 'M',
        sku: 'SH-BLK-M',
        price: sar('429.00'),
        available: false,
        inventoryQuantity: 0,
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        id: 'gid://shopify/ProductVariant/90032',
        title: 'L',
        sku: 'SH-BLK-L',
        price: sar('429.00'),
        available: false,
        inventoryQuantity: 0,
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
    ],
  },
  {
    id: 'gid://shopify/Product/9004',
    handle: 'desert-cap',
    title: 'Desert Cap',
    description:
      'Six-panel unstructured cap in washed twill with a tonal embroidered mark. One size, adjustable strap.',
    productType: 'Accessories',
    tags: ['cap', 'hat', 'twill', 'accessory'],
    url: `${STORE}/products/desert-cap`,
    available: true,
    priceRange: { min: sar('129.00'), max: sar('129.00') },
    variants: [
      {
        id: 'gid://shopify/ProductVariant/90041',
        title: 'One size',
        sku: 'DC-TAN-OS',
        price: sar('129.00'),
        available: true,
        inventoryQuantity: 2,
        selectedOptions: [{ name: 'Size', value: 'One size' }],
      },
    ],
  },
];

export const orders: Order[] = [
  {
    // The happy path: verified email, shipped, trackable.
    id: 'gid://shopify/Order/2041',
    name: '#1886-2041',
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
    statusUrl: `${STORE}/orders/status/2041`,
  },
  {
    // Paid, not yet shipped. No tracking exists — the agent must not invent one.
    id: 'gid://shopify/Order/2042',
    name: '#1886-2042',
    email: 'sara@example.com',
    customerEmail: 'sara@example.com',
    createdAt: '2026-09-09T19:05:00Z',
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    cancelledAt: null,
    fulfillments: [],
    lineItems: [
      { title: 'Najd Cargo Pant', variantTitle: '32', sku: 'NC-OLV-32', quantity: 1 },
      { title: 'Desert Cap', variantTitle: 'One size', sku: 'DC-TAN-OS', quantity: 1 },
    ],
    totalPrice: sar('478.00'),
    shippingCity: 'Jeddah',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/2042`,
  },
  {
    // Guest checkout: there is no customer record, only the order email.
    id: 'gid://shopify/Order/2043',
    name: '#1886-2043',
    email: 'layla@example.com',
    customerEmail: null,
    createdAt: '2026-08-30T11:40:00Z',
    financialStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    fulfillments: [
      {
        status: 'delivered',
        trackingCompany: 'Aramex',
        trackingNumber: 'ARX4400188620431',
        trackingUrl: 'https://track.example/ARX4400188620431',
        updatedAt: '2026-09-02T16:10:00Z',
      },
    ],
    lineItems: [
      { title: 'Riyadh Oversized Tee', variantTitle: 'L', sku: 'RT-SAND-L', quantity: 2 },
    ],
    totalPrice: sar('378.00'),
    shippingCity: 'Dammam',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/2043`,
  },
  {
    // Order email and customer-record email differ. Either verifies.
    id: 'gid://shopify/Order/2044',
    name: '#1886-2044',
    email: 'omar@example.com',
    customerEmail: 'omar.k@example.com',
    createdAt: '2026-09-01T08:20:00Z',
    financialStatus: 'refunded',
    fulfillmentStatus: 'unfulfilled',
    cancelledAt: '2026-09-01T10:02:00Z',
    fulfillments: [],
    lineItems: [{ title: 'Sadu Hoodie', variantTitle: 'L', sku: 'SH-BLK-L', quantity: 1 }],
    totalPrice: sar('429.00'),
    shippingCity: 'Riyadh',
    shippingCountryCode: 'SA',
    statusUrl: `${STORE}/orders/status/2044`,
  },
  {
    // Cross-border, delivered, partially refunded.
    id: 'gid://shopify/Order/2045',
    name: '#1886-2045',
    email: 'nora@example.com',
    customerEmail: 'nora@example.com',
    createdAt: '2026-08-25T20:00:00Z',
    financialStatus: 'partially_refunded',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    fulfillments: [
      {
        status: 'delivered',
        trackingCompany: 'Aramex',
        trackingNumber: 'ARX4400188620452',
        trackingUrl: 'https://track.example/ARX4400188620452',
        updatedAt: '2026-08-31T13:45:00Z',
      },
    ],
    lineItems: [
      { title: 'Najd Cargo Pant', variantTitle: '30', sku: 'NC-OLV-30', quantity: 1 },
      { title: 'Riyadh Oversized Tee', variantTitle: 'S', sku: 'RT-SAND-S', quantity: 1 },
    ],
    totalPrice: sar('538.00'),
    shippingCity: 'Dubai',
    shippingCountryCode: 'AE',
    statusUrl: `${STORE}/orders/status/2045`,
  },
];
