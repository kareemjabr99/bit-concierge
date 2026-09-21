/**
 * The read-only view of a Shopify store the agent is allowed to have.
 *
 * There are no write methods on this interface. A write is not merely
 * disallowed in v1 — there is nothing to call. Phase 4 implements this against
 * the Admin GraphQL API with read scopes only; Phase 1 implements it over
 * synthetic fixtures.
 */

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface OrderLineItem {
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
}

export type FulfillmentStatus =
  'pending' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failure';

export interface Fulfillment {
  status: FulfillmentStatus;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  updatedAt: string;
}

export interface Order {
  id: string;
  /** Display name, e.g. "#1886-2041". */
  name: string;
  /** Email on the order itself. */
  email: string | null;
  /** Email on the linked customer record. Can differ from the order email. */
  customerEmail: string | null;
  createdAt: string;
  financialStatus: 'paid' | 'pending' | 'refunded' | 'partially_refunded' | 'voided';
  fulfillmentStatus: 'unfulfilled' | 'partial' | 'fulfilled';
  cancelledAt: string | null;
  fulfillments: Fulfillment[];
  lineItems: OrderLineItem[];
  totalPrice: Money;
  shippingCity: string | null;
  shippingCountryCode: string | null;
  /** Shopify's customer-facing order status page. */
  statusUrl: string | null;
}

export interface SelectedOption {
  name: string;
  value: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  price: Money;
  available: boolean;
  inventoryQuantity: number | null;
  /**
   * What the merchant has decided happens at zero stock: `deny` stops the
   * sale, `continue` lets it through.
   *
   * Carried explicitly rather than inferred from `available` and a quantity.
   * The inference is usually right and conflates two different things — a
   * variant can be unavailable because it is unpublished, and Shopify's
   * availability flag can disagree with the count. Read directly, the merchant
   * setting is the authority on whether zero means "no" or "yes, on
   * backorder", which is a decision they made and not one to reconstruct.
   */
  inventoryPolicy: 'deny' | 'continue';
  selectedOptions: SelectedOption[];
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  tags: string[];
  url: string;
  available: boolean;
  priceRange: { min: Money; max: Money };
  variants: ProductVariant[];
}

export interface ProductSearchFilters {
  productType?: string;
  tag?: string;
  availableOnly?: boolean;
  maxPrice?: number;
}

export interface ShopifyReadClient {
  getOrderByName(name: string): Promise<Order | null>;
  getProductByHandle(handle: string): Promise<Product | null>;
  searchProducts(query: string, filters?: ProductSearchFilters, limit?: number): Promise<Product[]>;
}

/**
 * What a customer is told about stock, as one value.
 *
 * `orderable_out_of_stock` is the state that used to be reported as
 * `in_stock`, which is what Shopify means by "available" and not what a
 * customer means by it. Zero on hand, and the merchant has chosen to keep
 * selling: the item can be ordered and is not in stock, and both halves have
 * to reach the customer or one of them is a lie.
 *
 * `low` is a band, not a count. The number behind it never leaves this
 * function, because a reply saying "only 2 left" carries a literal the tools
 * never returned, and because it is the kind of pressure a merchant should
 * choose to apply rather than have an assistant apply on their behalf.
 */
export type StockLevel = 'unknown' | 'in_stock' | 'low' | 'orderable_out_of_stock' | 'out_of_stock';

/** Low-stock threshold. Inclusive: 3 is low, 4 is not. */
const LOW_STOCK_AT = 3;

export const stockLevel = (variant: ProductVariant): StockLevel => {
  // No inventory tracking at all. Saying anything else would be inventing it.
  if (variant.inventoryQuantity === null) return 'unknown';

  // Availability vetoes first: a variant can be unbuyable for reasons that
  // have nothing to do with the count — unpublished, or archived, as the
  // discontinued mask in the fixtures is. Stock it has is stock nobody can
  // buy.
  if (!variant.available) return 'out_of_stock';

  if (variant.inventoryQuantity > 0) {
    return variant.inventoryQuantity <= LOW_STOCK_AT ? 'low' : 'in_stock';
  }

  // Zero, and buyable. The merchant's own setting decides what that means,
  // and it is read rather than inferred: `continue` is a deliberate decision
  // to accept orders past zero, `deny` at zero with an availability flag
  // still true is Shopify disagreeing with itself, and the policy is the half
  // that will hold at checkout.
  return variant.inventoryPolicy === 'continue' ? 'orderable_out_of_stock' : 'out_of_stock';
};

/**
 * Shopify order names are "#1234" or, with a prefix, "#1886-2041". Customers
 * type them every way imaginable. Normalise to "#" + compact uppercase.
 */
export const normalizeOrderName = (input: string): string => {
  const compact = input.replace(/\s+/g, '').replace(/^#+/, '').toUpperCase();
  return `#${compact}`;
};
