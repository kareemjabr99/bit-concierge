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
 * Shopify order names are "#1234" or, with a prefix, "#1886-2041". Customers
 * type them every way imaginable. Normalise to "#" + compact uppercase.
 */
export const normalizeOrderName = (input: string): string => {
  const compact = input.replace(/\s+/g, '').replace(/^#+/, '').toUpperCase();
  return `#${compact}`;
};
