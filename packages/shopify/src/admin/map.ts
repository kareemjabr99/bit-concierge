import { BitcError } from '@bitc/core';
import type {
  Fulfillment,
  FulfillmentStatus,
  Money,
  Order,
  Product,
  ProductVariant,
} from '../types.ts';

/**
 * Admin GraphQL shapes into the domain, with nothing guessed.
 *
 * Every mapping here is total over the values this build has an answer for,
 * and **throws for everything else**. That is the point rather than an
 * oversight. Shopify's enums are larger than this product's vocabulary —
 * eighteen fulfilment display statuses against six — and the tempting thing to
 * do with an unfamiliar one is fold it into the nearest familiar one. Folding
 * `ATTEMPTED_DELIVERY` into `in_transit` tells a customer their parcel is on
 * its way when the carrier has already tried and failed to hand it over.
 *
 * A throw here becomes a tool error, which becomes a hand-over. A customer
 * whose parcel is in a state nobody has written copy for gets a person, which
 * is the correct answer and the one we would give if asked.
 */

/**
 * A state Shopify reports and this build has not been taught to describe.
 *
 * Returns the error rather than throwing it, so every call site reads
 * `throw unmapped(...)`. A helper that throws for you narrows nothing: the
 * compiler goes on believing the value could still be null on the next line,
 * and the non-null assertions needed to quiet it are exactly the marks that
 * hide a real one later.
 */
const unmapped = (kind: string, value: string): BitcError =>
  new BitcError(
    'shopify_unmapped_state',
    `Shopify reported ${kind} "${value}". This build has no customer-facing ` +
      `answer for that state, so the turn hands over rather than describing it wrongly.`,
    { customerSafe: false },
  );

/**
 * Money, to a fixed number of decimals.
 *
 * Shopify is not consistent with itself: `MoneyV2.amount` comes back as
 * "189.0" and the `Money` scalar on a variant as "189.00", for the same
 * price. The literal gate compares what a reply says against what a tool
 * returned, so two spellings of one number is a difference that has to be
 * removed here rather than reasoned about downstream.
 *
 * Padded to two decimals, never truncated. Three-decimal currencies exist —
 * KWD and BHD are next door to this merchant — and rounding one to look tidy
 * would change the number.
 */
export const normalizeAmount = (amount: string): string => {
  const trimmed = amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new BitcError('shopify_bad_money', `Shopify returned an unreadable amount`, {
      customerSafe: false,
    });
  }
  const [whole, fraction = ''] = trimmed.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};

export interface MoneyV2Node {
  amount: string;
  currencyCode: string;
}

export const money = (node: MoneyV2Node): Money => ({
  amount: normalizeAmount(node.amount),
  currencyCode: node.currencyCode,
});

/**
 * Fulfilment display status.
 *
 * `FULFILLED` is the one that matters most and is the least obvious: it means
 * the merchant shipped it and the carrier has reported nothing. Every order
 * in the development store with tracking on it sits there. It is not
 * `pending`, because it has gone, and it is not `in_transit`, because nothing
 * has scanned it.
 *
 * **Deliberately absent**, each because the right thing to say to a customer
 * in that state is a decision nobody has made yet, and the wrong thing to say
 * is worse than a hand-over: `ATTEMPTED_DELIVERY`, `CANCELED`,
 * `CARRIER_PICKED_UP`, `DELAYED`, `LABEL_VOIDED`, `NOT_DELIVERED`,
 * `PICKED_UP`, `READY_FOR_PICKUP`. Several of them require the customer to do
 * something — rebook a delivery, collect a parcel — and an assistant that
 * cheerfully says "on its way" is actively in the way of that.
 */
const FULFILMENT_STATUS: Record<string, FulfillmentStatus> = {
  LABEL_PRINTED: 'pending',
  LABEL_PURCHASED: 'pending',
  SUBMITTED: 'pending',
  CONFIRMED: 'pending',
  FULFILLED: 'shipped',
  MARKED_AS_FULFILLED: 'shipped',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  FAILURE: 'failure',
};

/**
 * Order financial status.
 *
 * **Deliberately absent:** `AUTHORIZED`, `PARTIALLY_PAID`, `EXPIRED`. All
 * three are questions about money that has or has not moved, and this project
 * does not guess about money. They are also states the development store
 * cannot produce, so anything written for them would be written from a
 * reading of the documentation rather than from a real order.
 */
const FINANCIAL_STATUS: Record<string, Order['financialStatus']> = {
  PENDING: 'pending',
  PAID: 'paid',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  VOIDED: 'voided',
};

/**
 * Order fulfilment status.
 *
 * **Deliberately absent:** `RESTOCKED`, `PENDING_FULFILLMENT`, `OPEN`,
 * `IN_PROGRESS`, `ON_HOLD`, `SCHEDULED`, `REQUEST_DECLINED`. An order on hold
 * or with a declined fulfilment request is one where something has gone wrong
 * that a person should explain.
 */
const ORDER_FULFILMENT_STATUS: Record<string, Order['fulfillmentStatus']> = {
  UNFULFILLED: 'unfulfilled',
  PARTIALLY_FULFILLED: 'partial',
  FULFILLED: 'fulfilled',
};

export interface OrderNode {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  statusPageUrl: string | null;
  customer: { email: string | null } | null;
  totalPriceSet: { shopMoney: MoneyV2Node };
  currentTotalPriceSet: { shopMoney: MoneyV2Node };
  shippingAddress: { city: string | null; countryCodeV2: string | null } | null;
  lineItems: {
    nodes: {
      title: string;
      variantTitle: string | null;
      sku: string | null;
      quantity: number;
      currentQuantity: number;
    }[];
  };
  fulfillments: {
    displayStatus: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
    updatedAt: string;
  }[];
}

const fulfillment = (node: OrderNode['fulfillments'][number]): Fulfillment => {
  // A fulfilment with no display status at all is not a state to interpret.
  if (!node.displayStatus) throw unmapped('a fulfilment status', 'null');
  const status = FULFILMENT_STATUS[node.displayStatus];
  if (!status) throw unmapped('a fulfilment status', node.displayStatus);

  // Shopify allows several tracking numbers per fulfilment. One shipment is
  // the shape the agent can describe; more than one is a split delivery and a
  // different conversation.
  const tracking = node.trackingInfo[0] ?? null;
  return {
    status,
    trackingCompany: tracking?.company ?? null,
    trackingNumber: tracking?.number ?? null,
    trackingUrl: tracking?.url ?? null,
    updatedAt: node.updatedAt,
  };
};

export const toOrder = (node: OrderNode): Order => {
  const financial = FINANCIAL_STATUS[node.displayFinancialStatus ?? ''];
  if (!financial) throw unmapped('a payment status', node.displayFinancialStatus ?? 'null');
  const fulfilment = ORDER_FULFILMENT_STATUS[node.displayFulfillmentStatus ?? ''];
  if (!fulfilment) throw unmapped('an order status', node.displayFulfillmentStatus ?? 'null');

  return {
    id: node.id,
    name: node.name,
    email: node.email,
    // A guest checkout has no customer record at all, which is not the same as
    // one whose address happens to match the order's.
    customerEmail: node.customer?.email ?? null,
    createdAt: node.createdAt,
    financialStatus: financial,
    fulfillmentStatus: fulfilment,
    cancelledAt: node.cancelledAt,
    fulfillments: node.fulfillments.map(fulfillment),
    lineItems: node.lineItems.nodes.map((l) => ({
      title: l.title,
      variantTitle: l.variantTitle,
      sku: l.sku,
      quantity: l.quantity,
      currentQuantity: l.currentQuantity,
    })),
    totalPrice: money(node.totalPriceSet.shopMoney),
    currentTotalPrice: money(node.currentTotalPriceSet.shopMoney),
    shippingCity: node.shippingAddress?.city ?? null,
    shippingCountryCode: node.shippingAddress?.countryCodeV2 ?? null,
    statusUrl: node.statusPageUrl,
  };
};

export interface ProductNode {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  status: string;
  tags: string[];
  onlineStoreUrl: string | null;
  priceRangeV2: { minVariantPrice: MoneyV2Node; maxVariantPrice: MoneyV2Node };
  variants: {
    nodes: {
      id: string;
      title: string;
      sku: string | null;
      /** The `Money` scalar: an amount with no currency of its own. */
      price: string;
      availableForSale: boolean;
      inventoryQuantity: number | null;
      inventoryPolicy: string;
      selectedOptions: { name: string; value: string }[];
    }[];
  };
}

export const toProduct = (node: ProductNode): Product => {
  // Variant prices are bare amounts; the currency is the store's, and the
  // price range is where Shopify states it.
  const currencyCode = node.priceRangeV2.minVariantPrice.currencyCode;

  const variants: ProductVariant[] = node.variants.nodes.map((v) => {
    const policy = v.inventoryPolicy.toUpperCase();
    if (policy !== 'DENY' && policy !== 'CONTINUE') throw unmapped('an inventory policy', policy);
    return {
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: money({ amount: v.price, currencyCode }),
      available: v.availableForSale,
      inventoryQuantity: v.inventoryQuantity,
      inventoryPolicy: policy === 'CONTINUE' ? 'continue' : 'deny',
      selectedOptions: v.selectedOptions,
    };
  });

  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    description: node.description,
    productType: node.productType,
    tags: node.tags,
    // Null for anything not published to the Online Store channel. The agent
    // is told never to write a URL a tool did not return, so this being null
    // means no link rather than a constructed one.
    url: node.onlineStoreUrl,
    // An archived or draft product is findable and not purchasable. A customer
    // can still ask about something they already own.
    available: node.status === 'ACTIVE' && variants.some((v) => v.available),
    priceRange: {
      min: money(node.priceRangeV2.minVariantPrice),
      max: money(node.priceRangeV2.maxVariantPrice),
    },
    variants,
  };
};
