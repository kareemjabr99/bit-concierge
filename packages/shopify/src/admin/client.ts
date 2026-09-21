import type { Order, Product, ProductSearchFilters, ShopifyReadClient } from '../types.ts';
import { normalizeOrderName } from '../types.ts';
import type { AdminTransport } from './transport.ts';
import { toOrder, toProduct, type OrderNode, type ProductNode } from './map.ts';

/**
 * The real store, behind the same interface as the mock.
 *
 * There are no write methods, because there is nothing to write with: the
 * interface has none and the app's token carries read scopes only. The
 * separation is enforced twice, by two different mechanisms, because it is the
 * one that would be most expensive to get wrong.
 *
 * Everything here either returns a fact or throws. It never returns a
 * plausible substitute for one. A throw becomes a tool error, which becomes a
 * hand-over to a person — the correct answer to "where is my order" when the
 * store cannot be reached, and the whole reason this product is worth buying
 * over one that improvises.
 */

const ORDER_FIELDS = `
  id name email createdAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus statusPageUrl
  customer { email }
  totalPriceSet { shopMoney { amount currencyCode } }
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { city countryCodeV2 }
  lineItems(first: 50) { nodes { title variantTitle sku quantity currentQuantity } }
  fulfillments(first: 10) {
    displayStatus updatedAt
    trackingInfo { company number url }
  }`;

const PRODUCT_FIELDS = `
  id handle title description productType status tags onlineStoreUrl
  priceRangeV2 {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
  variants(first: 100) {
    nodes {
      id title sku price availableForSale inventoryQuantity inventoryPolicy
      selectedOptions { name value }
    }
  }`;

const ORDER_QUERY = `query($q: String!) { orders(first: 2, query: $q) { nodes { ${ORDER_FIELDS} } } }`;
const PRODUCT_QUERY = `query($q: String!, $n: Int!) { products(first: $n, query: $q) { nodes { ${PRODUCT_FIELDS} } } }`;

/**
 * A value going into Shopify's search syntax, as a literal.
 *
 * Customer text reaches this function. Shopify's query language has fields —
 * `status:DRAFT`, `tag:private`, `inventory_total:>0` — and an unquoted string
 * that happens to contain a colon is a filter rather than a search term. A
 * customer asking about "status:draft" would otherwise be running a query
 * against the merchant's unpublished work.
 *
 * Quoting makes it a literal. Backslashes first, then quotes, or the escaping
 * escapes its own escapes.
 */
const literal = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** At most this many words from a customer's question reach the query. */
const MAX_TERMS = 12;

const searchTerms = (query: string): string =>
  query
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, MAX_TERMS)
    .map(literal)
    .join(' ');

export class ShopifyAdminClient implements ShopifyReadClient {
  private readonly transport: AdminTransport;

  constructor(transport: AdminTransport) {
    this.transport = transport;
  }

  async getOrderByName(name: string): Promise<Order | null> {
    const wanted = normalizeOrderName(name);
    // `first: 2` rather than 1: Shopify's name search is a text match, so a
    // second hit means the question was ambiguous. Returning the first of two
    // would be a guess about whose order a customer is asking after, and this
    // is the one place in the product where guessing costs the most.
    const data = await this.transport.query<{ orders: { nodes: OrderNode[] } }>(ORDER_QUERY, {
      q: `name:${literal(wanted)}`,
    });

    const exact = data.orders.nodes.filter((n) => normalizeOrderName(n.name) === wanted);
    // No match and more-than-one match are the same answer to the caller: we
    // cannot say. The identity gate turns both into the same refusal, so a
    // customer learns nothing about which it was.
    if (exact.length !== 1) return null;
    return toOrder(exact[0]!);
  }

  async getProductByHandle(handle: string): Promise<Product | null> {
    const wanted = handle.trim().toLowerCase();
    if (wanted.length === 0) return null;
    const data = await this.transport.query<{ products: { nodes: ProductNode[] } }>(PRODUCT_QUERY, {
      q: `handle:${literal(wanted)}`,
      n: 2,
    });
    const exact = data.products.nodes.find((n) => n.handle.toLowerCase() === wanted);
    return exact ? toProduct(exact) : null;
  }

  async searchProducts(
    query: string,
    filters: ProductSearchFilters = {},
    limit = 5,
  ): Promise<Product[]> {
    const clauses: string[] = [];
    const terms = searchTerms(query);
    if (terms) clauses.push(terms);
    if (filters.productType) clauses.push(`product_type:${literal(filters.productType)}`);
    if (filters.tag) clauses.push(`tag:${literal(filters.tag)}`);

    // Availability and price are applied here rather than in the query,
    // because Shopify's product search does not filter on either in a way that
    // agrees with what `check_availability` reports. Over-fetching covers the
    // rows that will be dropped.
    //
    // It can still under-return: a store where most matches are sold out could
    // fill the window with them. That is the safe direction — the agent says
    // it did not find something rather than describing something it did not
    // fetch — and it is written down rather than discovered.
    const clientSideFilters = filters.availableOnly === true || filters.maxPrice !== undefined;
    const fetchCount = clientSideFilters ? Math.min(50, Math.max(limit * 5, 10)) : limit;

    const data = await this.transport.query<{ products: { nodes: ProductNode[] } }>(PRODUCT_QUERY, {
      q: clauses.join(' '),
      n: fetchCount,
    });

    return (
      data.products.nodes
        // A draft is a merchant's unfinished work — half-priced, half-described,
        // not theirs to show yet. Archived is different and stays: a customer can
        // ask about something they already own.
        .filter((n) => n.status !== 'DRAFT')
        .map(toProduct)
        .filter((p) => {
          if (filters.availableOnly === true && !p.available) return false;
          if (filters.maxPrice !== undefined && Number(p.priceRange.min.amount) > filters.maxPrice)
            return false;
          return true;
        })
        .slice(0, limit)
    );
  }
}
