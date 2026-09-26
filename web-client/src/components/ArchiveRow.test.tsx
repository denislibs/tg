// ── ПИН tweb e934b9039: у строки «Архив» нет риппла ──────────────────────────
//
// tweb archiveDialog.tsx снял `rp` и `ripple(...)` со строки архива: ряд
// ведёт в свою вкладку, волна на нём не нужна. Остальные классы строки —
// прежние (геометрия та же, что у обычного диалога).
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyLang } from '../test/lang'
import ArchiveRow from './ArchiveRow'

beforeEach(async () => {
  await applyLang('en')
})

afterEach(() => {
  cleanup()
})

describe('ArchiveRow без риппла (tweb e934b9039)', () => {
  it('ни класса rp, ни узла волны — и на нажатии тоже', () => {
    const { container } = render(<ArchiveRow chats={[]} onOpen={() => {}} />)
    const row = container.firstElementChild as HTMLElement
    expect(row.classList.contains('chatlist-chat')).toBe(true)
    expect(row.classList.contains('row-clickable')).toBe(true)
    expect(row.classList.contains('rp')).toBe(false)

    fireEvent.pointerDown(row, { clientX: 5, clientY: 5, button: 0 })
    expect(container.querySelector('.c-ripple')).toBeNull()
  })
})
