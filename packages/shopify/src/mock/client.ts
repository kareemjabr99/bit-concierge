import type { Order, Product, ProductSearchFilters, ShopifyReadClient } from '../types.ts';
import { normalizeOrderName } from '../types.ts';
import { orders, products } from './fixtures.ts';

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);

/** In-memory implementation over the fixtures. Deterministic, no network. */
export class MockShopifyClient implements ShopifyReadClient {
  private readonly data: { orders: Order[]; products: Product[] };

  constructor(data: { orders: Order[]; products: Product[] } = { orders, products }) {
    this.data = data;
  }

  async getOrderByName(name: string): Promise<Order | null> {
    const wanted = normalizeOrderName(name);
    return this.data.orders.find((o) => normalizeOrderName(o.name) === wanted) ?? null;
  }

  async getProductByHandle(handle: string): Promise<Product | null> {
    const wanted = handle.trim().toLowerCase();
    return this.data.products.find((p) => p.handle === wanted) ?? null;
  }

  async searchProducts(
    query: string,
    filters: ProductSearchFilters = {},
    limit = 5,
  ): Promise<Product[]> {
    const terms = tokens(query);
    const scored = this.data.products
      .filter((p) => {
        if (
          filters.productType &&
          p.productType.toLowerCase() !== filters.productType.toLowerCase()
        )
          return false;
        if (filters.tag && !p.tags.includes(filters.tag.toLowerCase())) return false;
        if (filters.availableOnly && !p.available) return false;
        if (filters.maxPrice !== undefined && Number(p.priceRange.min.amount) > filters.maxPrice)
          return false;
        return true;
      })
      .map((p) => {
        const haystack = [p.title, p.handle, p.productType, p.description, ...p.tags]
          .join(' ')
          .toLowerCase();
        const score = terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0);
        return { p, score };
      })
      .filter(({ score }) => terms.length === 0 || score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ p }) => p);
  }
}
