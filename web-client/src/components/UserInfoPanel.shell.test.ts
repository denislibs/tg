// Каркас панели профиля — ТОЛЬКО глобальные классы tweb, без CSS-модуля.
//
// Эталон — живой дамп docs/tweb/dom/dumps/07-right-sidebar.json:
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
//
// ЗАДАЧА 5 (docs/superpowers/plans/2026-09-05-profile-avatars-class.md):
// панель больше не рисует карусель инлайн — узел класса `PeerProfileAvatars`
// встаёт вместо неё через `useImperativeIsland`. Пины на `is-collapsed`/
// `need-white`/структуру карусели (`.profile-avatars-avatars`, стрелки,
// градиенты, …) СНЯТЫ — этих строк в файле больше нет, они переехали в
// `peerProfileAvatars.ts` и держатся ПОВЕДЕНЧЕСКИМИ тестами
// `peerProfileAvatars.test.ts` (DOM конструктора, is-collapsed/need-white на
// `setCollapsedOn`, header-filled по порогам). `header-filled` остаётся
// React-состоянием панели (вторая, не сводимая с классом половина, см. бриф
// задачи 5 п.3) — её пин жив.
//
// ЗАДАЧА 3 профиля на Solid (docs/superpowers/plans/2026-09-05-profile-card-
// solid.md): peer-title/subtitle в `.profile-avatars-info` БОЛЬШЕ НЕ React —
// React-портал туда (`avatarsInfoEl && createPortal(...)`, `VerifiedBadge`/
// `PremiumBadge`/`EmojiStatus`/`PeerStatus`) снесён вместе со своим пином
// текстом: это и есть «держалось текстом — теперь держится поведенческими
// тестами Solid-компонента» (правило задачи, см. её бриф) —
// `peerProfile.solid.test.tsx` проверяет ФАКТОМ, что имя/статус оказываются
// внутри переданного `avatarsInfo`, а не здесь. Пин ниже держит только то,
// что этот файл всё ещё делает: узел-хозяин острова аватарок пуст, а
// `instance.info` уходит в Solid-мост пропом `avatarsInfo` у того же вызова
// `mountSolid`, которым смонтирован `.profile-content` (единственный писатель
// узла — Solid, см. докблок `avatarsHostRef`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

/** Блок `{...}`, начинающийся на `src[braceStart]` (обязана быть `{`) — балансом скобок.
 *  Тот же приём, что в `src/App.authMount.test.ts` — не regex до `}` где попало. */
function extractBraceBalanced(src: string, braceStart: number): string {
  if (src[braceStart] !== '{') {
    throw new Error(`ожидалась '{' на позиции ${braceStart}, найдено: ${JSON.stringify(src[braceStart])}`)
  }
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  throw new Error('не сбалансированы скобки')
}

/** Тело первого вызова `useImperativeIsland(` — от `(container) => {` до ЕГО
 *  закрывающей скобки (баланс, не индекс до произвольной точки дальше по файлу). */
function extractImperativeIslandBody(src: string): string {
  const marker = 'useImperativeIsland('
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('useImperativeIsland(...) не найден')
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) throw new Error('открывающая { тела setup не найдена')
  return extractBraceBalanced(src, braceStart)
}

/** Тело единственного `useLayoutEffect(() => {...}, [folded])` — эффект
 *  «folded → setCollapsed» с гейтом `shouldForceFold` (tweb createEffect
 *  `:340-348`). Балансом скобок, тем же приёмом. */
function extractFoldedLayoutEffectBody(src: string): string {
  const marker = 'useLayoutEffect('
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('useLayoutEffect(...) не найден')
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) throw new Error('открывающая { тела эффекта не найдена')
  return extractBraceBalanced(src, braceStart)
}

/** Тело `useLayoutEffect(...)`, содержащего маркер `marker` где-то внутри —
 *  тот же приём, что `extractUseLayoutEffectBodies` в `App.authMount.test.ts`
 *  (собрать ВСЕ эффекты, найти СВОЙ балансом скобок, а не индексом до
 *  произвольной точки дальше по файлу), но с фильтром по содержимому: в этом
 *  файле несколько `useLayoutEffect`, и «первый по тексту» — случайная
 *  привязка к сегодняшнему порядку хуков. */
function extractLayoutEffectBodyContaining(src: string, marker: string): string {
  const effectMarker = 'useLayoutEffect('
  let searchFrom = 0
  for (;;) {
    const start = src.indexOf(effectMarker, searchFrom)
    if (start === -1) break
    const braceStart = src.indexOf('{', start)
    if (braceStart === -1) throw new Error('открывающая { тела эффекта не найдена')
    const body = extractBraceBalanced(src, braceStart)
    if (body.includes(marker)) return body
    searchFrom = braceStart + body.length
  }
  throw new Error(`ни один useLayoutEffect не содержит ${JSON.stringify(marker)}`)
}

describe('UserInfoPanel — каркас на классах tweb', () => {
  it('вкладка слайдера: sidebar-slider > tabs-tab.profile-container, className СТАТИЧЕСКИЙ', () => {
    expect(panel).toMatch(/<div className="sidebar-content sidebar-slider tabs-container">/)
    // НАХОДКА РЕВЬЮ (Critical, раунд правок 3): ни один из четырёх динамических
    // классов состояния (is-collapsed/need-white/header-filled/can-add-members)
    // не вычисляется здесь строкой — className этого узла СТАТИЧЕСКИЙ литерал
    // (двойные кавычки JSX-атрибута, не аргумент `classNames(...)`), и остаётся
    // им ВСЕГДА: если бы он менялся, React при смене вычисленной строки
    // переписал бы `node.className` целиком, стирая классы, выставленные
    // classList.toggle'ом (класс PeerProfileAvatars и два эффекта панели ниже).
    expect(panel).toContain('ref={setCollapsedOnRef}')
    expect(panel).toContain('className="tabs-tab sidebar-slider-item scrollable-y-bordered shared-media-container profile-container active"')
    expect(panel).not.toMatch(/classNames\(\s*'tabs-tab sidebar-slider-item/)
    // header-filled/can-add-members/is-collapsed/need-white — ВСЕ четыре теперь
    // ТОЛЬКО через classList.toggle (класс — свою половину, панель — свою,
    // см. useLayoutEffect'ы у setCollapsedOnRef); ни один литерал-кавычка этих
    // классов внутри classNames(...) для ЭТОГО узла быть не должен.
    expect(panel).toMatch(/classList\.toggle\('header-filled', headerFilled\)/)
    expect(panel).toMatch(/classList\.toggle\('can-add-members', isGroup && !!canAddMembers && isRealChat\)/)
    expect(panel).not.toMatch(/'is-collapsed'/)
    expect(panel).not.toMatch(/'need-white'/)
  })

  it('шапка: sidebar-close-button с animated-close-icon + transition.slide-fade', () => {
    expect(panel).toMatch(/className="btn-icon sidebar-close-button"/)
    // X ⇄ назад — поворот полосок классом, а не подменой иконки
    expect(panel).toMatch(/'animated-close-icon', filled \? 'state-back' : ''/)
    expect(panel).toMatch(/'transition slide-fade', headerSlider\.containerClass/)
    expect(panel).toMatch(/className="sidebar-header__rows"/)
    expect(panel).toMatch(/className="sidebar-header__subtitle"/)
  })

  // Task 2 профиля на Solid (`docs/superpowers/plans/2026-09-05-profile-card-solid.md`):
  // `.profile-content`/delimiter больше НЕ строки этого файла — их рисует
  // Solid (`peerProfile.solid.tsx`), пин на их структуру — ТАМ
  // (`peerProfile.solid.test.tsx`, describe «корень .profile-content»), тем же
  // приёмом, каким структура карусели переехала в `peerProfileAvatars.test.ts`
  // (см. коммент выше). Здесь остаётся пин на сам ШОВ монтирования — см.
  // describe «шов монтирования PeerProfile» ниже.
  it('тело: sidebar-content > scrollable-y, узел-хозяин Solid-карточки', () => {
    expect(panel).toMatch(/<div className="sidebar-content">/)
    expect(panel).toMatch(/<div ref=\{bodyRef\} className="scrollable scrollable-y"/)
    expect(panel).toMatch(/<div ref=\{profileContentHostRef\} \/>/)
    expect(panel).not.toMatch(/<div className="profile-content">/)
    expect(panel).not.toMatch(/<div className="profile-content-delimiter" \/>/)
  })

  // Структура самой карусели (.profile-avatars-avatars, стрелки, градиенты,
  // avatar-full/avatar-gradient, …) больше НЕ в этом файле — она в DOM-пинах
  // «PeerProfileAvatars — DOM конструктора» / «tweb :81-109» в
  // `peerProfileAvatars.test.ts`. Здесь остаётся только контент, которым
  // по-прежнему владеет React: peer-title/бейджи/подзаголовок, портальные в
  // `instance.info` (см. коммент у `avatarsInfoEl` в файле).
  it('шапка-аватары: узел-хозяин острова пуст, info уходит в Solid-мост пропом', () => {
    expect(panel).toMatch(/<div ref=\{avatarsHostRef\} \/>/)
    expect(panel).toMatch(/avatarsInfo: avatarsInfoEl \?\? undefined/)
    expect(panel).not.toMatch(/className="profile-avatars-avatars"/)
    expect(panel).not.toMatch(/'profile-avatars-avatar media-container'/)
  })

  // Задача 3 профиля на Solid — React больше НЕ пишет в `.profile-avatars-info`
  // ни одним из способов, которыми раньше это делал (портал + три бейджа +
  // презенс-виджет). Отрицательный пин, а не только положительный выше:
  // именно повторное появление любой из этих строк и означало бы регресс
  // «второй писатель узла» (правило владения, план, шапка).
  it('React не пишет в info: старый портал/бейджи/презенс сняты целиком', () => {
    expect(panel).not.toMatch(/avatarsInfoEl && createPortal/)
    expect(panel).not.toMatch(/from '\.\/VerifiedBadge'/)
    expect(panel).not.toMatch(/from '\.\/PremiumBadge'/)
    expect(panel).not.toMatch(/from '\.\/EmojiStatus'/)
    expect(panel).not.toMatch(/from '\.\.\/shared\/ui\/peerStatus'/)
  })

  // Видео-аватарка (AvatarVideo, animationIntersector.addAnimation/
  // removeAnimationByPlayer на конкретном <video>) снесена вместе с
  // карусельной самоделкой — тот же учёт теперь ВНУТРИ класса
  // (`peerProfileAvatars.ts`, покрыт `peerProfileAvatars.test.ts`, describe
  // «rAF-прогресс полоски видео-аватара»). `toggleVideosUnder` на ВСЮ колонку
  // — это ОТДЕЛЬНЫЙ, не карусельный механизм (порт tweb sidebarRight/index.ts:
  // 98,132): он гасит ЛЮБЫЕ видео под закрытой колонкой, включая будущие
  // (не только аватар), поэтому остаётся в панели и пинуется отдельно.
  it('AvatarVideo снесена; toggleVideosUnder на закрытие колонки остался (не карусельный механизм)', () => {
    expect(panel).not.toMatch(/AvatarVideo/)
    expect(panel).not.toMatch(/animationIntersector\.addAnimation/)
    expect(panel).toMatch(/animationIntersector\.toggleVideosUnder\(columnRef\.current, !open\)/)
  })

  it('своего CSS-модуля у панели больше нет', () => {
    expect(panel).not.toMatch(/UserInfoPanel\.module\.scss/)
    expect(panel).not.toMatch(/className=\{s\./)
  })
})

// Пин на шов (задача 5, норма проводки, «Пин на шов» — обязан краснеть, если
// вызов класса вынести из эффекта или потерять уборку): образец —
// `src/App.authMount.test.ts`, привязка БАЛАНСОМ СКОБОК внутри тела эффекта,
// а не по факту наличия строки где-то в файле (та же история ложных
// срабатываний/пропусков, что там описана).
describe('UserInfoPanel — шов монтирования PeerProfileAvatars (useImperativeIsland)', () => {
  it('класс создаётся и добавляется в DOM ВНУТРИ тела setup, а не рядом с вызовом', () => {
    const body = extractImperativeIslandBody(panel)
    expect(body, 'new PeerProfileAvatars(...) не найден внутри тела setup useImperativeIsland').toMatch(/new PeerProfileAvatars\(/)
    expect(body, 'container.appendChild(instance.container) не найден внутри тела setup').toMatch(/container\.appendChild\(instance\.container\)/)
  })

  it('teardown ВНУТРИ того же тела зовёт instance.cleanup() и обнуляет ref (уборка)', () => {
    const body = extractImperativeIslandBody(panel)
    expect(body, 'instance.cleanup() не найден внутри тела setup').toMatch(/instance\.cleanup\(\)/)
    expect(body, 'avatarsRef.current = null не найден внутри тела setup (ref не обнуляется)').toMatch(/avatarsRef\.current = null/)
  })

  it('useImperativeIsland смонтирован с host+strays под ЖИВОЙ (не одноразовый) хост-узел панели', () => {
    // `mode: 'own'` создавал бы ЛИШНИЙ уровень DOM внутри host — панель
    // держит host сама (`avatarsHostRef`, живёт весь срок жизни панели),
    // поэтому выбран `host`-режим (дефолт, mode не передан) + `strays` —
    // decided-and-declared выбор, см. коммент у вызова в файле.
    expect(panel).toMatch(/\{ host: avatarsHostRef, strays: '\.profile-avatars-container' \}/)
  })

  // tweb createEffect `:340-348`, портирован ЦЕЛИКОМ (не только setCollapsed):
  // гейт «нет фото → держать свёрнутым» (`shouldForceFold`, `userInfo/helpers.ts`,
  // логика проверена отдельно в `helpers.test.ts`) обязан реально ГЕЙТИТЬ —
  // звать `fold()` ДО `setCollapsed(folded)`, а не просто существовать где-то
  // в файле рядом с эффектом.
  it('эффект folded→setCollapsed зовёт shouldForceFold и fold() ВНУТРИ своего тела, до setCollapsed', () => {
    const body = extractFoldedLayoutEffectBody(panel)
    expect(body, 'shouldForceFold(...) не найден внутри тела useLayoutEffect').toMatch(/shouldForceFold\(instance\.hasPhoto, folded\)/)
    expect(body, 'instance.setCollapsed(folded) не найден внутри тела useLayoutEffect').toMatch(/instance\.setCollapsed\(folded\)/)
    const gateIdx = body.indexOf('shouldForceFold(')
    const foldIdx = body.indexOf('fold()')
    const setCollapsedIdx = body.indexOf('instance.setCollapsed(folded)')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(foldIdx).toBeGreaterThan(gateIdx) // fold() — ветка ПОСЛЕ гейта
    expect(setCollapsedIdx).toBeGreaterThan(foldIdx) // setCollapsed — уже после обеих веток гейта
  })
})

// Пин на шов задачи 2 (`docs/superpowers/plans/2026-09-05-profile-card-solid.md`):
// та же норма проводки, тот же приём (баланс скобок ВНУТРИ тела эффекта, не
// «строка где-то в файле»), что и у шва `PeerProfileAvatars` выше и у
// `App.authMount.test.ts`.
describe('UserInfoPanel — шов монтирования PeerProfile (Solid, mountSolid)', () => {
  it('mountSolid(host, PeerProfile, props) вызывается ВНУТРИ ТЕЛА эффекта, keyed на peerId', () => {
    const body = extractLayoutEffectBodyContaining(panel, 'mountSolid(')
    expect(body).toMatch(/return mountSolid\(\s*host,\s*PeerProfile,\s*\{/)
    // Эффект обязан быть keyed на peerId — иначе Solid-корень не пересоздаётся
    // при смене пира (докблок `peerProfile.solid.tsx` § «Пересоздание на
    // каждый peerId»), и context.peer/fullPeer застревают на первом пире.
    // Deps проверяем СНАРУЖИ тела (React синтаксис), балансом до `}, [`.
    const afterBody = panel.slice(panel.indexOf(body) + body.length)
    const depsMatch = afterBody.match(/^\s*,\s*\[([^\]]*)\]/)
    expect(depsMatch, 'массив зависимостей useLayoutEffect не найден сразу после тела').not.toBeNull()
    expect(depsMatch![1]).toMatch(/\bpeerId\b/)
  })

  it('searchSuperContainer — стабильный узел (useState, создан один раз), а не пересоздаётся на рендер', () => {
    expect(panel).toMatch(/const \[searchSuperContainer\] = useState\(\(\) => \{/)
  })

  it('SharedMedia рисуется порталом В searchSuperContainer, а не инлайн-JSX', () => {
    // Инлайн-обёртки `<div className="search-super">` вокруг <SharedMedia>
    // больше нет — узел теперь создаёт и отдаёт Solid (см. проп searchSuperContainer
    // в вызове mountSolid выше), React рисует В НЕГО порталом.
    expect(panel).not.toMatch(/<div className="search-super">/)
    expect(panel).toMatch(/createPortal\(\s*<SharedMedia/)
    expect(panel).toMatch(/searchSuperContainer,\s*\)/)
  })
})
