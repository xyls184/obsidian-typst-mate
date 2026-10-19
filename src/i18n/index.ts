import en from '@resources/locales/en.json';
import zh from '@resources/locales/zh.json';
import i18next, { type TOptions } from 'i18next';

export type InterpolationValues = Record<string, string | number>;

/**
 * Recursively extracts dot-separated paths from a nested object type, producing a union of all leaf keys.
 * e.g., `"settings.compiler.font.heading"`
 */
type NestedKeys<T, Prefix extends string = ''> =
  T extends Record<string, unknown>
    ? { [K in keyof T & string]: NestedKeys<T[K], `${Prefix}${K}.`> }[keyof T & string]
    : Prefix extends `${infer R}.`
      ? R
      : Prefix;

export type TranslationKey = NestedKeys<typeof en>;

const i18n = i18next.createInstance();

function detectLocale(): string {
  const getLocalStorage = (): string | null => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('language') : null;
    } catch {
      return null;
    }
  };

  const getMomentLocale = (): string | null => {
    try {
      const g = globalThis as unknown as { moment?: { locale?: () => string } };
      return typeof g.moment?.locale === 'function' ? g.moment.locale() : null;
    } catch {
      return null;
    }
  };

  const getDocLang = (): string | null => {
    try {
      return typeof document !== 'undefined' ? document.documentElement?.lang : null;
    } catch {
      return null;
    }
  };

  const getNavLanguages = (): string[] => {
    try {
      if (typeof navigator === 'undefined') return [];
      return [...(navigator.languages ?? []), navigator.language].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
    } catch {
      return [];
    }
  };

  // Obsidian stores an explicit language in localStorage, but it is absent
  // when the UI follows the system locale. Fall back to moment.locale(),
  // the document language, and finally to the browser locale.
  const candidates = [
    getLocalStorage(),
    getMomentLocale(),
    getDocLang(),
    ...getNavLanguages(),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());

  // Obsidian reports Simplified Chinese as `zh`, `zh-cn`, or `zh-hans`.
  // Traditional Chinese (`zh-tw`, `zh-hk`, `zh-hant`, `zh-mo`) falls back to English until a
  // dedicated locale exists.
  for (const locale of candidates) {
    if (
      locale.startsWith('zh-tw') ||
      locale.startsWith('zh-hk') ||
      locale.startsWith('zh-mo') ||
      locale.startsWith('zh-hant')
    ) {
      continue;
    }
    if (locale === 'zh' || locale.startsWith('zh-')) return 'zh';
    if (locale === 'en' || locale.startsWith('en-')) return 'en';
  }

  return 'en';
}

export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(detectLocale());
    return;
  }

  await i18n.init({
    lng: detectLocale(),
    fallbackLng: 'en',
    defaultNS: 'translation',
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    showSupportNotice: false,
  });
}

/**
 * Returns a translated string for the given key.
 */
export function t(key: TranslationKey, options?: TOptions<InterpolationValues>): string {
  return i18n.t(key, options);
}

export { tFragment } from './fragment';
