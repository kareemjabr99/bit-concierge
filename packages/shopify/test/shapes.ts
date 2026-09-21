import type { OrderNode, ProductNode } from '../src/index.ts';

/**
 * Admin GraphQL responses, exactly as the development store returned them.
 *
 * SOURCE: bit-concierge-dev-blb8x6ix.myshopify.com Admin GraphQL 2026-07 (checked 2026-09-21)
 *
 * Recorded rather than written, because three of the assumptions in the first
 * draft of the mapper were wrong and all three were wrong in the same
 * direction — the shape the documentation implies rather than the one the API
 * sends:
 *
 * - A fulfilment with tracking and no carrier scan reports `FULFILLED`. Not
 *   `IN_TRANSIT`. Creating a shipment does not make Shopify believe a carrier
 *   has it.
 * - `variantTitle` is null for the default variant, not "Default Title".
 * - `MoneyV2.amount` is "189.0" while the `Money` scalar on a variant is
 *   "189.00", for the same price in the same store.
 *
 * The order status URLs are redacted. They are capability links — the page
 * opens the order without a login — and a synthetic customer is not a reason
 * to commit one. Nothing in the mapper reads the value.
 *
 * Every customer here is invented and the store is a development store. There
 * is no real order data in this file and there never will be: real records go
 * through a paid key under a data-processing agreement.
 */

export const DELIVERED_ORDER: OrderNode = {
  id: 'gid://shopify/Order/7634252792030',
  name: '#1886-1003',
  email: 'layla@example.com',
  createdAt: '2026-09-21T09:19:51Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  statusPageUrl: 'https://dev-store.example/orders/status/REDACTED',
  customer: {
    email: 'layla@example.com',
  },
  totalPriceSet: {
    shopMoney: {
      amount: '258.0',
      currencyCode: 'SAR',
    },
  },
  currentTotalPriceSet: {
    shopMoney: {
      amount: '258.0',
      currencyCode: 'SAR',
    },
  },
  shippingAddress: {
    city: 'Dammam',
    countryCodeV2: 'SA',
  },
  lineItems: {
    nodes: [
      {
        title: 'TFMC Tote Bag',
        variantTitle: null,
        sku: 'TT-NAT-OS',
        quantity: 2,
        currentQuantity: 2,
      },
    ],
  },
  fulfillments: [
    {
      displayStatus: 'DELIVERED',
      updatedAt: '2026-09-21T09:32:26Z',
      trackingInfo: [
        {
          company: 'SMSA Express',
          number: 'SMSA1886204300',
          url: 'https://track.example/SMSA1886204300',
        },
      ],
    },
  ],
};

/** Partially refunded: one line of two returned, and the totals differ. */
export const PARTIALLY_REFUNDED_ORDER: OrderNode = {
  id: 'gid://shopify/Order/7634259706078',
  name: '#1886-1007',
  email: 'nora@example.com',
  createdAt: '2026-09-21T09:30:58Z',
  cancelledAt: null,
  displayFinancialStatus: 'PARTIALLY_REFUNDED',
  displayFulfillmentStatus: 'FULFILLED',
  statusPageUrl: 'https://dev-store.example/orders/status/REDACTED',
  customer: {
    email: 'nora@example.com',
  },
  totalPriceSet: {
    shopMoney: {
      amount: '344.0',
      currencyCode: 'SAR',
    },
  },
  currentTotalPriceSet: {
    shopMoney: {
      amount: '215.0',
      currencyCode: 'SAR',
    },
  },
  shippingAddress: {
    city: 'Riyadh',
    countryCodeV2: 'SA',
  },
  lineItems: {
    nodes: [
      {
        title: 'TFMC Logo Tee',
        variantTitle: 'M',
        sku: 'TFMC-BLUE-M',
        quantity: 1,
        currentQuantity: 1,
      },
      {
        title: 'TFMC Tote Bag',
        variantTitle: null,
        sku: 'TT-NAT-OS',
        quantity: 1,
        currentQuantity: 0,
      },
    ],
  },
  fulfillments: [
    {
      displayStatus: 'FULFILLED',
      updatedAt: '2026-09-21T09:30:59Z',
      trackingInfo: [
        {
          company: 'SMSA Express',
          number: 'SMSA1886204500',
          url: 'https://track.example/SMSA1886204500',
        },
      ],
    },
  ],
};

/** Cancelled and refunded, with a customer account whose email is not the order\u2019s. */
export const CANCELLED_ORDER: OrderNode = {
  id: 'gid://shopify/Order/7634252890334',
  name: '#1886-1004',
  email: 'k@example.com',
  createdAt: '2026-09-21T09:19:53Z',
  cancelledAt: '2026-09-21T09:19:55Z',
  displayFinancialStatus: 'REFUNDED',
  displayFulfillmentStatus: 'UNFULFILLED',
  statusPageUrl: 'https://dev-store.example/orders/status/REDACTED',
  customer: {
    email: 'omar@example.com',
  },
  totalPriceSet: {
    shopMoney: {
      amount: '749.0',
      currencyCode: 'SAR',
    },
  },
  currentTotalPriceSet: {
    shopMoney: {
      amount: '0.0',
      currencyCode: 'SAR',
    },
  },
  shippingAddress: {
    city: 'Riyadh',
    countryCodeV2: 'SA',
  },
  lineItems: {
    nodes: [
      {
        title: 'Classic Jacket SS24',
        variantTitle: 'M',
        sku: 'CJ-KHAKI-M',
        quantity: 1,
        currentQuantity: 0,
      },
    ],
  },
  fulfillments: [],
};

/** A guest checkout: `customer` is null rather than matching. */
export const GUEST_ORDER: OrderNode = {
  id: 'gid://shopify/Order/7634255773918',
  name: '#1886-1006',
  email: 'guest@example.com',
  createdAt: '2026-09-21T09:24:11Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  statusPageUrl: 'https://dev-store.example/orders/status/REDACTED',
  customer: null,
  totalPriceSet: {
    shopMoney: {
      amount: '189.0',
      currencyCode: 'SAR',
    },
  },
  currentTotalPriceSet: {
    shopMoney: {
      amount: '189.0',
      currencyCode: 'SAR',
    },
  },
  shippingAddress: {
    city: 'Riyadh',
    countryCodeV2: 'SA',
  },
  lineItems: {
    nodes: [
      {
        title: 'Riyadh Oversized Tee',
        variantTitle: 'L',
        sku: 'RT-SAND-L',
        quantity: 1,
        currentQuantity: 1,
      },
    ],
  },
  fulfillments: [],
};

/** Shipped with tracking, no carrier scan \u2014 the commonest state of all. */
export const SHIPPED_ORDER: OrderNode = {
  id: 'gid://shopify/Order/7634244206814',
  name: '#1886-1001',
  email: 'ahmed@example.com',
  createdAt: '2026-09-21T09:03:24Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  statusPageUrl: 'https://dev-store.example/orders/status/REDACTED',
  customer: {
    email: 'ahmed@example.com',
  },
  totalPriceSet: {
    shopMoney: {
      amount: '189.0',
      currencyCode: 'SAR',
    },
  },
  currentTotalPriceSet: {
    shopMoney: {
      amount: '189.0',
      currencyCode: 'SAR',
    },
  },
  shippingAddress: {
    city: 'Riyadh',
    countryCodeV2: 'SA',
  },
  lineItems: {
    nodes: [
      {
        title: 'Riyadh Oversized Tee',
        variantTitle: 'M',
        sku: 'RT-SAND-M',
        quantity: 1,
        currentQuantity: 1,
      },
    ],
  },
  fulfillments: [
    {
      displayStatus: 'FULFILLED',
      updatedAt: '2026-09-21T09:19:48Z',
      trackingInfo: [
        {
          company: 'SMSA Express',
          number: 'SMSA1886204100',
          url: 'https://track.example/SMSA1886204100',
        },
      ],
    },
  ],
};

/** Zero stock selling on, zero stock refusing, and stock in the middle. */
export const JACKET: ProductNode = {
  id: 'gid://shopify/Product/9347519578334',
  handle: 'classic-jacket-ss24',
  title: 'Classic Jacket SS24',
  description: 'Boxy cotton-twill jacket with a concealed placket and welt pockets.',
  productType: 'Outerwear',
  status: 'ACTIVE',
  tags: ['bitc-seed'],
  onlineStoreUrl: null,
  priceRangeV2: {
    minVariantPrice: {
      amount: '749.0',
      currencyCode: 'SAR',
    },
    maxVariantPrice: {
      amount: '749.0',
      currencyCode: 'SAR',
    },
  },
  variants: {
    nodes: [
      {
        id: 'gid://shopify/ProductVariant/49085647323358',
        title: 'S',
        sku: 'CJ-KHAKI-S',
        price: '749.00',
        availableForSale: true,
        inventoryQuantity: 0,
        inventoryPolicy: 'CONTINUE',
        selectedOptions: [
          {
            name: 'Size',
            value: 'S',
          },
        ],
      },
      {
        id: 'gid://shopify/ProductVariant/49085647356126',
        title: 'M',
        sku: 'CJ-KHAKI-M',
        price: '749.00',
        availableForSale: true,
        inventoryQuantity: 6,
        inventoryPolicy: 'DENY',
        selectedOptions: [
          {
            name: 'Size',
            value: 'M',
          },
        ],
      },
      {
        id: 'gid://shopify/ProductVariant/49085647388894',
        title: 'L',
        sku: 'CJ-KHAKI-L',
        price: '749.00',
        availableForSale: false,
        inventoryQuantity: 0,
        inventoryPolicy: 'DENY',
        selectedOptions: [
          {
            name: 'Size',
            value: 'L',
          },
        ],
      },
    ],
  },
};

/** Archived, and a single default variant. */
export const ARCHIVED_MASK: ProductNode = {
  id: 'gid://shopify/Product/9347519774942',
  handle: '1886-mask-black',
  title: '1886 Mask',
  description: 'Machine-washable cotton mask with a moulded nose bridge.',
  productType: 'Accessories',
  status: 'ARCHIVED',
  tags: ['bitc-seed'],
  onlineStoreUrl: null,
  priceRangeV2: {
    minVariantPrice: {
      amount: '79.0',
      currencyCode: 'SAR',
    },
    maxVariantPrice: {
      amount: '79.0',
      currencyCode: 'SAR',
    },
  },
  variants: {
    nodes: [
      {
        id: 'gid://shopify/ProductVariant/49085648011486',
        title: 'Default Title',
        sku: 'MK-BLACK-OS',
        price: '79.00',
        availableForSale: false,
        inventoryQuantity: 0,
        inventoryPolicy: 'DENY',
        selectedOptions: [
          {
            name: 'Title',
            value: 'Default Title',
          },
        ],
      },
    ],
  },
};
