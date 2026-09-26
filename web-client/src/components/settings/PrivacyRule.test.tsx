// Строки исключений экрана правила приватности — tweb privacySection.tsx:177-218.
//
// У tweb это `Row.Icon` + `Row.Title` (формулировка исключения) +
// `Row.Subtitle` (число пользователей / «Add Users»): значение — ПОДЗАГОЛОВОК
// под заголовком. У нас оно стояло справа (`value` → `row-title-right`), а
// `.row-title-right` не сжимается (`flex: 0 0 auto !important`,
// _row.scss:230-234) — заголовок с `text-overflow: ellipsis` выдавливало до «N…».
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { usePrivacyStore } from '../../stores/privacyStore'
import { applyLang } from '../../test/lang'
import PrivacyRule from './PrivacyRule'

function renderRule() {
  return render(
    <ManagersProvider managers={{} as never}>
      <PrivacyRule title="PrivacyLastSeen" onBack={() => {}} />
    </ManagersProvider>,
  )
}

/** Строка по тексту заголовка — ищем `.row`, чей `.row-title` его несёт. */
function rowByTitle(container: HTMLElement, title: string): HTMLElement {
  const titleNode = Array.from(container.querySelectorAll<HTMLElement>('.row-title'))
    .find((node) => node.textContent === title)
  expect(titleNode, title).toBeDefined()
  return titleNode!.closest<HTMLElement>('.row')!
}

beforeEach(async () => {
  await applyLang('en')
  // «Мои контакты» — видны обе строки исключений (tweb :181-183).
  const rule = usePrivacyStore.getState().rules.last_seen
  usePrivacyStore.getState().setRule({ ...rule, value: 'contacts', allowUserIds: [], denyUserIds: [5, 6] })
})

afterEach(cleanup)

describe('PrivacyRule — строки исключений (tweb privacySection.tsx:214-216)', () => {
  it('число пользователей — подзаголовок под заголовком, а не значение справа', () => {
    const { container } = renderRule()

    const never = rowByTitle(container, 'Never Share With')
    expect(never.querySelector('.row-title-right')).toBeNull()
    expect(never.classList.contains('no-subtitle')).toBe(false)
    expect(never.querySelector(':scope > .row-subtitle')?.textContent).toBe('2 users')

    const always = rowByTitle(container, 'Always Share With')
    expect(always.querySelector('.row-title-right')).toBeNull()
    expect(always.querySelector(':scope > .row-subtitle')?.textContent).toBe('Add Users')
  })
})
