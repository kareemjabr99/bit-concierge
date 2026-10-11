/**
 * Log redaction. Section 11 of the brief: emails, phone numbers and addresses
 * never reach application logs. Full transcripts live in the database, which is
 * tenant-scoped and subject to the retention policy — not in stdout.
 *
 * This is deliberately over-eager. A redacted log line is an inconvenience; a
 * customer's phone number in a log aggregator is a notifiable incident.
 */

/**
 * An order's status page, as Shopify emails it to the customer.
 *
 *   https://shop.myshopify.com/80752312542/orders/<hex>/authenticate?key=<hex>
 *
 * The URL is the credential: it opens the order — items, address, tracking —
 * with no login. It is allowed to reach the customer who just verified the
 * order, and nowhere else (docs/adr/0012). Matched by shape, anywhere in a
 * string, whatever field carries it: the model can paste it into a summary the
 * tool never labelled. Any host, because a custom domain serves the same path,
 * and the mock's `/orders/status/<n>` form is covered so a fixture link cannot
 * teach a log a different habit from a real one.
 */
export const STATUS_URL = /https?:\/\/[^\s<>()"'\]]*\/orders\/[^\s<>()"'\]]*/gi;

export const STATUS_URL_PLACEHOLDER = '[status-link]';

/** `text` with every order status URL replaced. The one place that does it. */
export const stripStatusUrls = (text: string): string =>
  text.replace(STATUS_URL, STATUS_URL_PLACEHOLDER);

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

// International and Gulf formats: +966 5X XXX XXXX, 05XXXXXXXX, +20 ..., etc.
const PHONE = /(?:\+|00)\d[\d\s().-]{7,}\d|\b0\d[\d\s().-]{7,}\d\b/g;

// Any run of 6+ digits that is not obviously a year. Catches order numbers,
// tracking numbers and national IDs without needing to know their formats.
const LONG_DIGITS = /\b\d{6,}\b/g;

/** Field names whose value is replaced wholesale, whatever it looks like. */
const SENSITIVE_KEYS = new Set([
  'email',
  'emails',
  'phone',
  'phonenumber',
  'mobile',
  'address',
  'address1',
  'address2',
  'street',
  'postalcode',
  'zip',
  'name',
  'firstname',
  'lastname',
  'customername',
  'accesstoken',
  'token',
  'apikey',
  'secret',
  'password',
  'authorization',
  'cookie',
  'ordernumber',
  'trackingnumber',
  'statusurl',
  'statuspageurl',
]);

// Identifiers we trace by. A UUID group that happens to be all digits must
// survive the long-digit rule, or logs stop being searchable by conversation.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export const redactText = (value: string): string => {
  const ids: string[] = [];
  const shielded = value.replace(UUID, (id) => {
    ids.push(id);
    // Private-use characters: never in real text, and not control characters.
    return `\uE000${ids.length - 1}\uE001`;
  });
  return stripStatusUrls(shielded)
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
    .replace(LONG_DIGITS, '[number]')
    .replace(/\uE000(\d+)\uE001/g, (_, i: string) => ids[Number(i)]!);
};

const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));

/**
 * Walks a structured log payload. Sensitive keys are replaced by name; every
 * remaining string is run through the text patterns.
 */
export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? '[redacted]' : redact(entry, depth + 1);
  }
  return out;
};
