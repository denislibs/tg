// Задача 5 (docs/superpowers/plans/2026-09-05-profile-avatars-class.md):
// `shouldForceFold` — гейт «нет фото → держать свёрнутым» (tweb
// `peerProfileAvatars.ts:341-344`), вынесенный чистой функцией именно для
// того, чтобы его можно было протестировать напрямую — эффект-потребитель
// (`UserInfoPanel.tsx`, `folded → avatars.setCollapsed(folded)`) сам
// нерендерибелен в vitest (см. `UserInfoPanel.shell.test.ts`). Норма проводки
// брифа задачи 5: «Гейт обязателен к покрытию тестом: пир без фото не
// разворачивается колесом» — здесь это и покрыто, на уровне булевой логики.
import { describe, expect, it } from 'vitest'
import { shouldForceFold } from './helpers'

describe('shouldForceFold (tweb :341-344)', () => {
  it('нет фото и уже развёрнуто (folded=false) → форсировать fold', () => {
    expect(shouldForceFold(false, false)).toBe(true)
  })

  it('нет фото, но и так свёрнуто (folded=true) → форсировать нечего (условие оригинала — !folded())', () => {
    expect(shouldForceFold(false, true)).toBe(false)
  })

  it('есть фото — гейт не форсирует fold ни в развёрнутом, ни в свёрнутом состоянии', () => {
    expect(shouldForceFold(true, false)).toBe(false)
    expect(shouldForceFold(true, true)).toBe(false)
  })
})
