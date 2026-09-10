import type { ShippingRule } from '../context.ts';

/** How customers name destinations. Codes, English and Arabic names, major cities. */
const ALIASES: Record<string, string> = {
  uae: 'AE',
  emirates: 'AE',
  'united arab emirates': 'AE',
  dubai: 'AE',
  'abu dhabi': 'AE',
  sharjah: 'AE',
  الامارات: 'AE',
  الإمارات: 'AE',
  دبي: 'AE',
  ابوظبي: 'AE',
  'أبو ظبي': 'AE',
  ksa: 'SA',
  saudi: 'SA',
  'saudi arabia': 'SA',
  riyadh: 'SA',
  jeddah: 'SA',
  dammam: 'SA',
  khobar: 'SA',
  السعودية: 'SA',
  الرياض: 'SA',
  جدة: 'SA',
  الدمام: 'SA',
  kuwait: 'KW',
  الكويت: 'KW',
  bahrain: 'BH',
  manama: 'BH',
  البحرين: 'BH',
  qatar: 'QA',
  doha: 'QA',
  قطر: 'QA',
  الدوحة: 'QA',
  oman: 'OM',
  muscat: 'OM',
  عمان: 'OM',
  مسقط: 'OM',
};

export const findShippingRule = (
  rules: ShippingRule[],
  country: string,
  city?: string,
): ShippingRule | undefined => {
  const keys = [country, city].filter((v): v is string => !!v).map((v) => v.trim().toLowerCase());
  for (const key of keys) {
    const code = ALIASES[key] ?? key.toUpperCase();
    const rule = rules.find(
      (r) => r.country.toUpperCase() === code || r.label.toLowerCase() === key,
    );
    if (rule) return rule;
  }
  return undefined;
};
