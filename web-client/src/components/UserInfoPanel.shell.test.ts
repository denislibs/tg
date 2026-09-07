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
// `core/hooks/useSearchSuper.test.tsx`: `UserInfoPanel` тянет портал,
// менеджеры и полдюжины сторов, а проверяемое здесь — ровно строки разметки.
// Мутация «вернули модульный класс вместо глобального» краснит здесь: без
// tweb-имён панель теряет портированную геометрию и анимации
// (`styles/tweb/_profile.scss`, `_sidebar.scss`, `_scrollable.scss`,
// `_transition.scss`) молча — ни сборка, ни тайпчек этого не видят.
//
// ЗАДАЧА 5 (docs/superpowers/plans/2026-09-05-profile-avatars-class.md):
// панель больше не рисует карусель инлайн — узел класса `PeerProfileAvatars`
// встаёт вместо неё (с задачи 13 плана shared media — пропом `avatarsContainer`
// в Solid-корень, первым ребёнком `.profile-content`). Пины на `is-collapsed`/
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
// что этот файл всё ещё делает: React-хоста у карусели нет вовсе, а
// `instance.container`/`instance.info` уходят в Solid-мост пропами
// `avatarsContainer`/`avatarsInfo` у того же вызова `mountSolid`, которым
// смонтирован `.profile-content` (единственный писатель узла — Solid, см.
// докблок `avatars`).
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

/** Тело layout-эффекта, создающего класс аватарок (`new PeerProfileAvatars(`)
 *  — с задачи 13 это обычный `useLayoutEffect` (deps `[]`), а не
 *  `useImperativeIsland`: узел класса уходит в Solid-корень, React-хоста нет. */
function extractAvatarsEffectBody(src: string): string {
  return extractLayoutEffectBodyContaining(src, 'new PeerProfileAvatars(')
}

/** Тело `useLayoutEffect(() => {...}, [folded])` — эффект «folded →
 *  setCollapsed» с гейтом `shouldForceFold` (tweb createEffect `:340-348`).
 *  По СОДЕРЖИМОМУ, а не «первый по тексту»: порядок хуков в файле — не предмет пина. */
function extractFoldedLayoutEffectBody(src: string): string {
  return extractLayoutEffectBodyContaining(src, 'shouldForceFold(')
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
  it('шапка-аватары: React-хоста нет, container/info класса уходят в Solid-мост пропами', () => {
    expect(panel).not.toMatch(/avatarsHostRef/)
    const body = extractLayoutEffectBodyContaining(panel, 'mountSolid<PeerProfileProps>(')
    expect(body).toMatch(/avatarsContainer: avatars\.container/)
    expect(body).toMatch(/avatarsInfo: avatars\.info/)
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
describe('UserInfoPanel — шов монтирования PeerProfileAvatars (layout-эффект + узел-проп)', () => {
  it('класс создаётся ВНУТРИ тела layout-эффекта и отдаётся панели состоянием (setAvatars)', () => {
    const body = extractAvatarsEffectBody(panel)
    expect(body).toMatch(/new PeerProfileAvatars\(/)
    expect(body).toMatch(/avatarsRef\.current = instance/)
    expect(body).toMatch(/setAvatars\(instance\)/)
    // Узел класса НЕ кладётся в React-хост — он уходит в Solid-корень пропом
    // (см. тест «шапка-аватары» выше); `useImperativeIsland` здесь не место.
    expect(body).not.toMatch(/appendChild/)
    expect(panel).not.toMatch(/useImperativeIsland\(/)
  })

  it('teardown ВНУТРИ того же тела зовёт instance.cleanup() и обнуляет ref/состояние (уборка)', () => {
    const body = extractAvatarsEffectBody(panel)
    expect(body, 'instance.cleanup() не найден внутри тела эффекта').toMatch(/instance\.cleanup\(\)/)
    expect(body, 'avatarsRef.current = null не найден внутри тела эффекта (ref не обнуляется)').toMatch(/avatarsRef\.current = null/)
    expect(body).toMatch(/setAvatars\(null\)/)
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

// Пин на шов задачи 2 (`docs/superpowers/plans/2026-09-05-profile-card-solid.md`),
// переписан под контракт задачи 5.5 (мост `mountSolid` вернул `{ dispose,
// update }` вместо голого `dispose`, докблок `mountSolid.solid.tsx`): та же
// норма проводки, тот же приём (баланс скобок ВНУТРИ тела эффекта, не «строка
// где-то в файле»), что и у шва `PeerProfileAvatars` выше и у
// `App.authMount.test.ts`.
describe('UserInfoPanel — шов монтирования PeerProfile (Solid, mountSolid)', () => {
  it('mountSolid<PeerProfileProps>(host, PeerProfile, props) вызывается ВНУТРИ ТЕЛА структурного эффекта, keyed на peerId', () => {
    const body = extractLayoutEffectBodyContaining(panel, 'mountSolid<PeerProfileProps>(')
    expect(body).toMatch(/const \{ dispose, update \} = mountSolid<PeerProfileProps>\(\s*host,\s*PeerProfile,\s*\{/)
    // Уборка обязана и снять ref на `update` (иначе эффект апдейта после
    // размонтирования этого корня писал бы в мёртвый Solid-инстанс), и
    // позвать dispose — тем же порядком, что и у остальных швов моста.
    expect(body).toMatch(/profileUpdateRef\.current = null/)
    expect(body).toMatch(/dispose\(\)/)
    // Эффект обязан быть keyed на peerId — иначе Solid-корень не пересоздаётся
    // при смене пира (докблок `peerProfile.solid.tsx` § «Пересоздание на
    // каждый peerId»), и context.peer/fullPeer застревают на первом пире.
    // Deps проверяем СНАРУЖИ тела (React синтаксис), балансом до `}, [`.
    const afterBody = panel.slice(panel.indexOf(body) + body.length)
    const depsMatch = afterBody.match(/^\s*,\s*\[([^\]]*)\]/)
    expect(depsMatch, 'массив зависимостей useLayoutEffect не найден сразу после тела').not.toBeNull()
    expect(depsMatch![1]).toMatch(/\bpeerId\b/)
    // Задача 5.5: структурный эффект пересоздаёт корень ТОЛЬКО на peerId/
    // searchSuper/avatars — гейты/данные Task 5 (canViewStats,
    // joinRequests, …) уехали в отдельный эффект апдейта (см. describe ниже),
    // сюда они не должны вернуться ни в тело (кроме `...buildProfilePatch()`,
    // общего строителя, а не отдельных полей), ни в deps.
    expect(body).toMatch(/\.\.\.buildProfilePatch\(\)/)
    expect(body).not.toMatch(/showStatistics:/)
    expect(depsMatch![1]).not.toMatch(/\bjoinRequests\b/)
  })

  it('эффект апдейта пишет живой патч в тот же корень через profileUpdateRef, не пересоздавая его', () => {
    const body = extractLayoutEffectBodyContaining(panel, 'profileUpdateRef.current?.(buildProfilePatch())')
    expect(body).not.toMatch(/mountSolid/) // апдейт НЕ зовёт mountSolid — иначе это снова пересоздание корня
    const afterBody = panel.slice(panel.indexOf(body) + body.length)
    const depsMatch = afterBody.match(/^\s*,\s*\[([\s\S]*?)\]/)
    expect(depsMatch, 'массив зависимостей эффекта апдейта не найден сразу после тела').not.toBeNull()
    // Гейты/данные Task 5 — здесь, а не в deps структурного эффекта выше.
    expect(depsMatch![1]).toMatch(/\bcanViewStats\b/)
    expect(depsMatch![1]).toMatch(/\bjoinRequests\b/)
    expect(depsMatch![1]).not.toMatch(/\bpeerId\b/)
  })

  // Задача 13 плана shared media (`docs/superpowers/plans/2026-09-07-solid-wave-3-
  // shared-media.md`): узел шаред-медиа больше НЕ создаёт React — его создаёт и
  // уничтожает класс `AppSearchSuper` (хук `useSearchSuper`), а Solid-корень
  // получает `searchSuper.container` пропом (tweb `sharedMedia.tsx:166`).
  // Поведение шва (узел один на панель, переезжает в новый корень, следов после
  // размонтирования нет) — `core/hooks/useSearchSuper.test.tsx`; здесь пин,
  // что РЕАЛЬНАЯ панель собрана в той же форме.
  it('узел шаред-медиа — контейнер класса из useSearchSuper, а не свой div и не портал React', () => {
    expect(panel).toMatch(/useSearchSuper\(/)
    const body = extractLayoutEffectBodyContaining(panel, 'mountSolid<PeerProfileProps>(')
    expect(body).toMatch(/searchSuperContainer: searchSuper\.container/)
    expect(panel).not.toMatch(/className = 'search-super'/)
    expect(panel).not.toMatch(/userInfo\/SharedMedia/)
    expect(panel).not.toMatch(/<SharedMedia/)
  })

  // Шаг 3 задачи 13: инлайновый `stickyTop`/`TAB_GAP` перебивал портированный
  // `top: var(--super-offset)` (`_searchSuper.scss:24`) — липкий ряд прилипал
  // под absolute-шапку (P1 из `docs/research/2026-08-08-tweb-deep-structural-audit.md`).
  // Мутация «вернуть stickyTop={TAB_GAP}» или любую запись `style.top` — красная.
  it('липкость ряда вкладок — CSS, без инлайнового top (stickyTop/TAB_GAP сняты)', () => {
    expect(panel).not.toMatch(/stickyTop/)
    expect(panel).not.toMatch(/TAB_GAP/)
    expect(panel).not.toMatch(/style\.top/)
  })

  // Контракт шапки — tweb `sharedMedia.tsx:484-517`: `onAdditionalScroll`
  // скроллера меряет ряд класса (`isSharedMediaReached`, `userInfo/helpers.ts`),
  // `setIsSharedMedia` переключает `is-full-viewport` на контейнере класса и
  // при выходе зовёт `cleanScrollPositions()`; `scrollStartCallback` класса
  // ставит режим шаред-медиа. React-обработчик `onScroll` на теле снят —
  // скролл слушает `Scrollable` хозяина.
  it('шапка переведена на контракт класса: onAdditionalScroll → isSharedMediaReached, is-full-viewport, cleanScrollPositions', () => {
    expect(panel).toMatch(/scrollable\.onAdditionalScroll = \(\) => \{/)
    expect(panel).toMatch(/isSharedMediaReached\(searchSuper\)/)
    expect(panel).toMatch(/searchSuper\.container\.classList\.toggle\('is-full-viewport', isSharedMedia\)/)
    expect(panel).toMatch(/searchSuper\.cleanScrollPositions\(\)/)
    expect(panel).toMatch(/searchSuper\.scrollStartCallback = /)
    expect(panel).not.toMatch(/onScroll=\{/)
    expect(panel).not.toMatch(/tabsBarRef/)
  })

  // Пункт 6 задачи 13: участников грузит класс (`loadMembers`), хосту отдаются
  // `openPeer`/`openUserPermissions` (расхождение 33 в шапке класса).
  it('участники — у класса: realMembers/refreshMembers сняты, хосту переданы openPeer/openUserPermissions', () => {
    expect(panel).not.toMatch(/realMembers/)
    expect(panel).not.toMatch(/refreshMembers/)
    expect(panel).toMatch(/openPeer:/)
    expect(panel).toMatch(/openUserPermissions:/)
  })
})
