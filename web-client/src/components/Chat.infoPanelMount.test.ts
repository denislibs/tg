// src/components/Chat.infoPanelMount.test.ts
//
// Пин: панель профиля (`UserInfoPanel`, роль tweb `AppSharedMediaTab` в
// `#column-right`) строится ВМЕСТЕ С ЧАТОМ, а клик по шапке только
// открывает её. У tweb вкладку шаред-медиа создаёт и наполняет смена пира
// чата — `chat.ts:1003-1008` (`createSharedMediaTab` + `setPeer`) и
// `finishPeerChange` `:1224-1229` (`fillProfileElements` + `loadSidebarMedia`),
// а клик — лишь `appSidebarRight.toggleSidebar(true)` (sidebarRight/index.ts:
// 104-138): класс на body, выезд колонки transform'ом. С задачи 0б-0 это и у
// нас класс (`components/sidebarRight/index.ts`), а панель — содержимое
// вкладки №0, которую инстанс создаёт при монтировании.
//
// Прежде панель монтировалась ПО ПЕРВОМУ КЛИКУ (`infoMounted`): клик →
// загрузка ленивого чанка → троттлинг Suspense (~300 мс без работы) → монтаж
// всей панели одной задачей (223 мс при CPU×4 в trace) → колонка вставлялась
// в DOM уже с `body.is-right-column-shown`, и transition не играл вовсе
// (выскакивала без выезда). Разбор с цифрами — в теле коммита.
//
// Почему СКАН ИСХОДНИКА — то же основание, что у `Chat.feedMount.test.ts`:
// `Chat.tsx` в vitest не рендерится (заявленное исключение, web-client/CLAUDE.md).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')

/** JSX-блок `<Suspense …>…</Suspense>`, внутри которого стоит `<UserInfoPanel`. */
function panelSuspenseBlock(): string {
  const at = CHAT_TSX.indexOf('<UserInfoPanel')
  if (at === -1) return ''
  const start = CHAT_TSX.lastIndexOf('<Suspense', at)
  const end = CHAT_TSX.indexOf('</Suspense>', at)
  if (start === -1 || end === -1) return ''
  return CHAT_TSX.slice(start, end)
}

describe('Chat.tsx — панель профиля строится до клика', () => {
  it('UserInfoPanel ждёт только вкладку №0, созданную эффектом монтирования, — ни гейта по клику, ни «уже открывали»', () => {
    const block = panelSuspenseBlock()
    expect(block).toContain('<UserInfoPanel')
    // Между `<Suspense …>` и `<UserInfoPanel` нет условного рендера.
    const beforePanel = block.slice(block.indexOf('>') + 1, block.indexOf('<UserInfoPanel'))
    expect(beforePanel).not.toMatch(/&&|\?/)
    // Снаружи Suspense — ровно одно условие: вкладка есть.
    const at = CHAT_TSX.lastIndexOf('<Suspense', CHAT_TSX.indexOf('<UserInfoPanel'))
    expect(CHAT_TSX.slice(at - 40, at)).toMatch(/\{profileTab && \(\s*$/)
    // Вкладку создаёт эффект монтирования инстанса (deps `[]`), а не клик.
    expect(CHAT_TSX).toMatch(/useEffect\(\(\) => \{\s*const sidebar = appSidebarRight\s*const tab = sidebar\.createSharedMediaTab\(\)\s*setProfileTab\(tab\)[\s\S]*?\}, \[\]\)/)
    expect(CHAT_TSX).not.toMatch(/infoMounted|setInfoMounted/)
  })

  it('клик по шапке — только `appSidebarRight.toggleSidebar`, своего состояния открытия у чата нет', () => {
    expect(CHAT_TSX).not.toMatch(/infoOpen|setInfoOpen/)
    expect(panelSuspenseBlock()).toMatch(/<UserInfoPanel\s+profileTab=\{profileTab\}/)
    expect(CHAT_TSX).toMatch(/const onToggleInfo = useEvent\(\(\) => \{ void appSidebarRight\.toggleSidebar\(/)
  })

  it('активный инстанс ставит свою вкладку в слайдер (replaceSharedMediaTab), уходящий — снимает и разрушает', () => {
    expect(CHAT_TSX).toMatch(/if \(isActiveInstance && profileTab\) appSidebarRight\.replaceSharedMediaTab\(profileTab\)/)
    expect(CHAT_TSX).toMatch(/if \(sidebar\.sharedMediaTab === tab\) \{\s*void sidebar\.toggleSidebar\(false\)\s*sidebar\.replaceSharedMediaTab\(\)\s*\}\s*tab\.destroy\(\)/)
  })
})
