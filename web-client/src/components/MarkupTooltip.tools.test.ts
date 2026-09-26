// Иконки кнопок markup-тултипа — tweb markupTooltip.ts:66-76.
// После dae12932f → 12eeb9b1c у цитаты одна иконка `blockquote` (запись
// `['quote', 'blockquote']` = тип + неактивная иконка, активной НЕТ): кнопка
// больше не меняет глиф во включённом состоянии.
import { describe, expect, it } from 'vitest'
import { MARKUP_TOOLS } from './MarkupTooltip'

describe('MARKUP_TOOLS', () => {
  it('порядок и иконки как у tweb (без date — сущности нет)', () => {
    expect(MARKUP_TOOLS.map((t) => t.icon)).toEqual([
      'bold', 'italic', 'underline', 'strikethrough', 'monospace', 'spoiler', 'blockquote',
    ])
  })

  it('цитата — `blockquote` без активного варианта', () => {
    const quote = MARKUP_TOOLS.find((t) => t.type === 'messageEntityBlockquote')!
    expect(quote.icon).toBe('blockquote')
    expect(Object.keys(quote)).not.toContain('activeIcon')
  })
})
