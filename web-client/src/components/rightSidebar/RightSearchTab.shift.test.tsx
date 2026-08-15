// Пин: экран поиска правой колонки (стикеры/GIF) обязан сужать чат тем же
// классом body.is-right-column-shown, что и панель профиля (UserInfoPanel) —
// иначе (баг из ТЗ) панель ложится ПОВЕРХ чата вместо того, чтобы его сузить
// (styles/tweb/_chat.scss:438,458,513 — сдвиг #column-center только под этим
// классом).
//
// Экран поиска и панель профиля МОГУТ быть открыты одновременно:
// StickersSearchTab/GifsSearchTab открываются из подвала EmojiDropdown
// композера (см. EmojiDropdown.tsx:712-713) — композер виден и кликабелен и
// при открытой панели профиля (панель лишь сужает чат, не блокирует его),
// поэтому пользователь может открыть профиль (UserInfoPanel open=true),
// затем — поиск стикеров. Оба навешивают один и тот же класс на body, значит
// класс обязан жить за счётчиком открытых правых панелей
// (useRightColumnShown), а не за булевым toggle одной панели — иначе закрытие
// экрана поиска сняло бы класс и у ещё открытой панели профиля. Сам счётчик
// покрыт отдельно в useRightColumnShown.test.ts; здесь пинится факт, что
// RightSearchTab им пользуется (совместно с UserInfoPanel).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RightSearchTab from './RightSearchTab'

afterEach(cleanup)

const noop = () => {}

describe('RightSearchTab и сдвиг контента', () => {
  it('пока открыт (смонтирован), на body висит класс сужения чата', () => {
    render(
      <RightSearchTab id="stickers-container" placeholder="Search Stickers" value="" onChange={noop} onClose={noop}>
        {null}
      </RightSearchTab>,
    )
    expect(document.body.classList.contains('is-right-column-shown')).toBe(true)
  })

  it('снимает класс при размонтировании (закрытии) единственной открытой панели', () => {
    const { unmount } = render(
      <RightSearchTab id="stickers-container" placeholder="Search Stickers" value="" onChange={noop} onClose={noop}>
        {null}
      </RightSearchTab>,
    )
    unmount()
    expect(document.body.classList.contains('is-right-column-shown')).toBe(false)
  })

  it('не снимает класс при закрытии одной панели, пока рядом открыта другая правая панель', () => {
    // вторая смонтированная панель имитирует одновременно открытую
    // UserInfoPanel — обе завязаны на общий счётчик useRightColumnShown.
    const first = render(
      <RightSearchTab id="stickers-container" placeholder="Search Stickers" value="" onChange={noop} onClose={noop}>
        {null}
      </RightSearchTab>,
    )
    const second = render(
      <RightSearchTab id="search-gifs-container" placeholder="Search GIFs" value="" onChange={noop} onClose={noop}>
        {null}
      </RightSearchTab>,
    )
    first.unmount()
    expect(document.body.classList.contains('is-right-column-shown')).toBe(true)
    second.unmount()
    expect(document.body.classList.contains('is-right-column-shown')).toBe(false)
  })
})
