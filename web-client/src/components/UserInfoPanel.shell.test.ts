// Каркас панели профиля — глобальные классы tweb, а не CSS-модуль.
//
// Эталон — живой дамп docs/research/tweb-dom/07-right-sidebar.json:
//   div.tabs-tab.sidebar.sidebar-right.main-column
//     > div.sidebar-header > button.btn-icon.sidebar-close-button + …__title
//     + div.sidebar-content > div.scrollable.scrollable-y
//
// Пин текстовый (а не рендер) — по тому же основанию, что уже принято для этого
// файла в `userInfo/SharedMedia.saved.test.tsx`: `UserInfoPanel` тянет портал,
// менеджеры и полдюжины сторов, а проверяемое здесь — ровно строки разметки.
// Мутация «сняли глобальный класс / вернули модульный дубль» краснит здесь:
// без `.sidebar-header`/`.sidebar-content`/`.scrollable-y` панель теряет
// портированную геометрию (`styles/tweb/_sidebar.scss`, `_scrollable.scss`)
// молча — ни сборка, ни тайпчек этого не видят.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')
const styles = readFileSync(join(__dirname, 'UserInfoPanel.module.scss'), 'utf8')

describe('UserInfoPanel — каркас на классах tweb', () => {
  it('шапка: div.sidebar-header > button.btn-icon.sidebar-close-button + div.sidebar-header__title', () => {
    expect(panel).toMatch(/className=\{classNames\('sidebar-header', s\.header/)
    expect(panel).toMatch(/<IconButton className="sidebar-close-button"/)
    expect(panel).toMatch(/className=\{classNames\('sidebar-header__title', s\.headerTitles\)\}/)
  })

  it('тело: div.sidebar-content > div.scrollable.scrollable-y', () => {
    expect(panel).toMatch(/<div className="sidebar-content">/)
    expect(panel).toMatch(/className=\{classNames\('scrollable', 'scrollable-y', s\.body\)\}/)
  })

  it('модуль больше не дублирует то, что дают партиалы tweb', () => {
    // раскладку шапки (flex/align-items/min-height/padding-inline) даёт `.sidebar-header`
    expect(styles).not.toMatch(/\.header \{[^}]*display: flex/s)
    // размер и скролл тела дают `.scrollable.scrollable-y`
    expect(styles).not.toMatch(/\.body \{[^}]*overflow-y: auto/s)
  })
})
