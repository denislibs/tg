// Каркас панели профиля — ТОЛЬКО глобальные классы tweb, без CSS-модуля.
//
// Эталон — живой дамп docs/research/tweb-dom/07-right-sidebar.json:
//   div.tabs-tab.sidebar.sidebar-right.main-column
//     > div.sidebar-content.sidebar-slider.tabs-container
//       > div.tabs-tab.sidebar-slider-item.…shared-media-container.profile-container.active
//         > div.sidebar-header
//             > button.btn-icon.sidebar-close-button > div.animated-close-icon
//             + div.transition.slide-fade > 2 × div.transition-item
//         + div.sidebar-content > div.scrollable.scrollable-y > div.profile-content
//             > div.profile-avatars-container > … + div.profile-content-delimiter
//
// Пин текстовый (а не рендер) — по тому же основанию, что и в
// `userInfo/SharedMedia.saved.test.tsx`: `UserInfoPanel` тянет портал,
// менеджеры и полдюжины сторов, а проверяемое здесь — ровно строки разметки.
// Мутация «вернули модульный класс вместо глобального» краснит здесь: без
// tweb-имён панель теряет портированную геометрию и анимации
// (`styles/tweb/_profile.scss`, `_sidebar.scss`, `_scrollable.scss`,
// `_transition.scss`) молча — ни сборка, ни тайпчек этого не видят.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

describe('UserInfoPanel — каркас на классах tweb', () => {
  it('вкладка слайдера: sidebar-slider > tabs-tab.profile-container с состояниями на НЕЙ', () => {
    expect(panel).toMatch(/<div className="sidebar-content sidebar-slider tabs-container">/)
    expect(panel).toMatch(/'tabs-tab sidebar-slider-item scrollable-y-bordered shared-media-container profile-container active'/)
    // состояния шапки-аватаров — классы вкладки (tweb `_profile.scss`)
    expect(panel).toMatch(/'is-collapsed'/)
    expect(panel).toMatch(/'header-filled'/)
    expect(panel).toMatch(/'need-white'/)
  })

  it('шапка: sidebar-close-button с animated-close-icon + transition.slide-fade', () => {
    expect(panel).toMatch(/className="btn-icon sidebar-close-button"/)
    // X ⇄ назад — поворот полосок классом, а не подменой иконки
    expect(panel).toMatch(/'animated-close-icon', filled \? 'state-back' : ''/)
    expect(panel).toMatch(/'transition slide-fade', headerSlider\.containerClass/)
    expect(panel).toMatch(/className="sidebar-header__rows"/)
    expect(panel).toMatch(/className="sidebar-header__subtitle"/)
  })

  it('тело: sidebar-content > scrollable-y > profile-content с разделителем', () => {
    expect(panel).toMatch(/<div className="sidebar-content">/)
    expect(panel).toMatch(/<div ref=\{bodyRef\} className="scrollable scrollable-y"/)
    expect(panel).toMatch(/<div className="profile-content">/)
    expect(panel).toMatch(/<div className="profile-content-delimiter" \/>/)
  })

  it('шапка-аватары: контейнер, дорожка, градиенты, стрелки, info — имена tweb', () => {
    expect(panel).toMatch(/'profile-avatars-container', canPage \? '' : 'is-single'/)
    expect(panel).toMatch(/className="profile-avatars-avatars"/)
    expect(panel).toMatch(/'profile-avatars-avatar media-container'/)
    expect(panel).toMatch(/className="avatar avatar-like avatar-full avatar-gradient profile-avatars-avatar-first"/)
    expect(panel).toMatch(/className="avatar-photo"/)
    expect(panel).toMatch(/className="profile-avatars-gradient profile-avatars-gradient-top"/)
    expect(panel).toMatch(/className="profile-avatars-arrow profile-avatars-arrow-next"/)
    expect(panel).toMatch(/className="profile-avatars-info"/)
    expect(panel).toMatch(/<span className="peer-title">/)
    expect(panel).toMatch(/className="profile-subtitle-text"/)
  })

  it('своего CSS-модуля у панели больше нет', () => {
    expect(panel).not.toMatch(/UserInfoPanel\.module\.scss/)
    expect(panel).not.toMatch(/className=\{s\./)
  })
})
