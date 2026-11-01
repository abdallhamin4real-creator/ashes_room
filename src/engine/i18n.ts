import ar from '../i18n/ar.json'
import en from '../i18n/en.json'
import zh from '../i18n/zh-CN.json'
import type { Locale } from './save'

export type Dictionary = Record<string, string>
const DICTIONARIES: Record<Locale, Dictionary> = { ar, en, 'zh-CN': zh }

export function detectLocale(languages: readonly string[] | undefined): Locale {
  const first = (languages ?? []).find(Boolean) ?? ''
  return first.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
export function resolveLocale(saved: Locale | '', languages: readonly string[] | undefined): Locale {
  return saved === 'ar' || saved === 'en' || saved === 'zh-CN' ? saved : detectLocale(languages)
}

export class I18n {
  locale: Locale
  private listeners = new Set<(locale: Locale) => void>()
  constructor(locale: Locale) { this.locale = locale; document.documentElement.lang = locale; document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr' }
  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = DICTIONARIES[this.locale][key] ?? DICTIONARIES.ar[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }
  set(locale: Locale): void {
    if (locale === this.locale) return
    this.locale = locale
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    for (const fn of this.listeners) fn(locale)
  }
  onChange(fn: (locale: Locale) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
}

export const DICTIONARY_KEYS = { ar: Object.keys(ar), en: Object.keys(en), zh: Object.keys(zh) }
