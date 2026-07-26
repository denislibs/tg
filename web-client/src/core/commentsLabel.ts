import type { Lang } from '../i18n'

// Localized "N comments" label (tweb Chat.Title.Comments). Russian/Ukrainian use
// the Slavic 1 / 2-4 / 5+ plural forms; other locales fall back to the English
// singular/plural via t(). count 0 → the bare "Comments" heading.
export function commentsLabel(count: number, lang: Lang, t: (s: string) => string): string {
  if (count === 0) return t('Comments')
  if (lang === 'ru' || lang === 'uk') {
    const m10 = count % 10
    const m100 = count % 100
    let word: string
    if (m10 === 1 && m100 !== 11) word = lang === 'ru' ? 'комментарий' : 'коментар'
    else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) word = lang === 'ru' ? 'комментария' : 'коментарі'
    else word = lang === 'ru' ? 'комментариев' : 'коментарів'
    return `${count} ${word}`
  }
  return `${count} ${count === 1 ? t('Comment') : t('Comments')}`
}
