// Порт tweb `src/helpers/appWindow.ts` — корень оверлеев (`getOverlayRoot`,
// `:33-35`): body активного окна приложения. Выноса клиента в Document PiP у нас
// нет, поэтому активное окно — всегда вкладка, и корень — её `document.body`.
import { describe, expect, it } from 'vitest'
import { getOverlayRoot } from './appWindow'

describe('getOverlayRoot (tweb appWindow.ts:33-35)', () => {
  it('отдаёт body активного окна — вкладки', () => {
    expect(getOverlayRoot()).toBe(document.body)
  })
})
