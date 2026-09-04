# Волна 3, этап 1: экран входа целиком на Solid

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ — `superpowers:subagent-driven-development`.
> Шаги отмечаются чекбоксами `- [ ]`.

**Цель:** перевести экран входа (`components/auth/**`) с React на Solid целиком —
первый ЭКРАН программы, а не примитив: волны 0–2 дали мост, попапы и вкладки, здесь
впервые уезжает самостоятельная страница со своим роутингом и переходами.

**Архитектура:** источник — `tweb/src/pages/**`. Там шаг входа хранит МОДУЛЬНЫЙ
сигнал в собственном `createRoot` (`authFlow.tsx:78-84`), карточки лениво
подгружаются и переключаются `<Switch>`/`<Match keyed>` внутри
`<Transition mode="outin">` (`AuthCardsHost.tsx:196-243`), а вход снаружи Solid —
функция `navigateAuth(spec)` (`:91`). У нас сейчас то же самое собрано на
`useState` хоста (`AuthFlow.tsx:203`) и собственном `useCardTransition`
(`:134-185`). Переносим устройство оригинала, а не переписываем наше.

**Стек:** solid-js 1.9.15, vite-plugin-solid 2.11.14, TypeScript strict, vitest.

**Источник порта:** `/Users/denisurevic/Documents/tweb` (далее `tweb/`).

## Global Constraints

- **Источник порта — компонент tweb, а не наш React** (спека § 6a). Наши
  `components/auth/*.tsx` — не источник поведения; расхождение с ними не дефект порта.
- **Definition of Done** — `docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 9,
  все 14 пунктов. Особо: п. 4 (мутацию ФАКТИЧЕСКИ прогнать, вывод падения — в тело
  коммита), п. 14 (React обязан УБЫТЬ, а не удвоиться), п. 10 (живая проверка на стенде).
- **Маска Solid-файлов** — только `SOLID_FILE_PATTERN` из
  `web-client/src/shared/solid/fileRuntime.ts` (`*.solid.tsx`, `*.solid.test.tsx`).
  Никаких `@jsxImportSource` в React-файлах и наоборот; границу стережёт
  `shared/solid/boundary.test.ts`.
- **Мост — только `mountSolid`/`SolidIsland`** (`shared/solid/`). Своих `render()`
  не заводить; `ErrorBoundary` уже вшит в мост.
- **Никакого `git add -A`.** Коммитить только явно перечисленные пути.
- **Комментарии и сообщения коммитов — по-русски**, объяснять ПОЧЕМУ.
- Каждый порт несёт в шапке ссылку на источник вида `порт tweb/src/pages/authFlow.tsx`,
  со строками там, где взята нетривиальная деталь.
- Мёртвый код удалять: React-версия экрана уходит целиком, параллельных реализаций не остаётся.

---

## Опорные факты (проверены в исходниках, не пересказ)

| Вопрос | Оригинал (`tweb/src/pages/`) | У нас (`web-client/src/components/auth/`) |
|---|---|---|
| Где живёт шаг | модульный сигнал в своём `createRoot`, переживает HMR — `authFlow.tsx:78-84` | `useState` хоста — `AuthFlow.tsx:203` |
| Вход снаружи | `navigateAuth(spec)` — `authFlow.tsx:91`; стартовый шаг ставится ДО `render` — `mountAuthFlow.tsx:29` | ветка `authed ? <Shell/> : <AuthFlow/>` — `App.tsx:235` |
| Тип шага | дискриминированный `CardSpec` + `matchCard<K>` — `authFlow.tsx:52-56, :99-103` | строковый юнион `Card` — `AuthFlow.tsx:43` |
| Переключение | `<Switch>` из 7 `<Match keyed>` внутри `<Transition mode="outin">`, карточки `lazy()` — `AuthCardsHost.tsx:35-41, :196-243` | свой `useCardTransition` — `AuthFlow.tsx:134-185`, `CARD_TRANSITION_MS = 200` (`:50`) |
| Удержание предыдущей карточки | `children()` + `createMemo<JSX.Element>((prev) => cardChild() \|\| prev)` — `AuthCardsHost.tsx:227-230` | предмета нет: карточки не ленивые |
| Истории шагов | нет, только текущая карта; «назад» — явные переходы (`AuthCodeCard.tsx:77`, `PasswordCard.tsx:90`) | так же |
| Скролл хоста | `<Scrollable>` из `@components/scrollable2` (Solid, 355) — `AuthCardsHost.tsx:3` | своя разметка |
| Сторы | нет | **нет ни одного Zustand-стора** — проверено grep по `components/auth/` |

Из последней строки следует важное: DoD п. 12 («перенесённые сторы не потеряли
предохранители») в этом этапе **без предмета**, и это не поблажка, а факт — экран
входа состояния в сторах не держит. Нагруженным остаётся п. 14.

## Что уже есть и переиспользуется

`shared/solid/mountSolid.solid.tsx` (мост с `ErrorBoundary`), `SolidIsland.tsx`
(React-хост острова; контракт — стабильная ссылка на компонент),
`fileRuntime.ts` (маска рантайма), `components/section.solid.tsx`,
`rowTsx.solid.tsx`, `iconTsx.solid.tsx`, `rippleElement.solid.tsx`,
`checkboxFieldTsx.solid.tsx`. Образцы применения — `sidebarLeft/tabs/language.solid.tsx`,
`activeSessions.solid.tsx`.

Чего нет и что появится здесь: Solid-`Button` (порт `tweb/src/components/buttonTsx.tsx`,
109) и Solid-`Scrollable` (порт `tweb/src/components/scrollable2.tsx`, 355) — оба
нужны хосту карточек.

---

### Task 1: каркас роутинга — сигнал шага, контекст, типы

**Files:**
- Create: `web-client/src/components/auth/authFlow.solid.tsx`
- Create: `web-client/src/components/auth/authFlow.solid.test.tsx`

**Interfaces:**
- Consumes: —
- Produces:
  - `type CardName = 'signQR' | 'signIn' | 'authCode' | 'password' | 'signUp' | 'emailRecover' | 'signImport'`
  - `type CardSpec` — дискриминированное объединение `{name, payload}` по `CardName`
    (порт `tweb/src/pages/authFlow.tsx:34-56`); полезная нагрузка каждого шага берётся
    из наших нынешних полей хоста (`AuthFlow.tsx:213-230`: страна, телефон, `pwToken`,
    `pwHint`, `signUpToken`, `recoverPattern`, `webAuthToken`).
  - `navigateAuth(spec: CardSpec): void` — вход снаружи Solid (порт `:91`)
  - `useAuthFlow(): AuthFlowContextValue` — `{managers, current, navigate, back, toIm}` (порт `:58-68, :112-119`)
  - `matchCard<K extends CardName>(name: K): Accessor<Extract<CardSpec, {name: K}> | null>` (порт `:99-103`)

- [ ] **Step 1: Написать падающие пины**

Три факта, каждый — устройство оригинала, а не наша привычка:

```tsx
it('шаг живёт в собственном корне: navigateAuth снаружи компонента двигает current', () => { … })
it('matchCard сужает тип и отдаёт null для чужого шага', () => { … })
it('стартовый шаг можно поставить ДО монтирования хоста', () => { … })
```

Третий пин — порт `mountAuthFlow.tsx:29` (`navigateAuth` вызывается ДО `render`), и он
же ловит регресс «сигнал создаётся внутри компонента».

- [ ] **Step 2: Прогнать — падает** (`cd web-client && npx vitest run src/components/auth/authFlow.solid.test.tsx`)
- [ ] **Step 3: Реализовать** — порт `tweb/src/pages/authFlow.tsx` целиком; HMR-ветку
  (`import.meta.hot.data`) переносить дословно только если у нас включён HMR для Solid;
  иначе снять и назвать вычет в шапке файла.
- [ ] **Step 4: Зелёный прогон + мутация** — убрать вынос сигнала в `createRoot`
  (создать внутри компонента): пин «шаг живёт в собственном корне» обязан покраснеть.
- [ ] **Step 5: Коммит** — `feat(auth): каркас роутинга шага входа на Solid`

---

### Task 2: примитивы хоста — Solid-кнопка и Solid-скролл

**Files:**
- Create: `web-client/src/components/buttonTsx.solid.tsx` (порт `tweb/src/components/buttonTsx.tsx`, 109)
- Create: `web-client/src/components/scrollable2.solid.tsx` (порт `tweb/src/components/scrollable2.tsx`, 355)
- Create: тесты на оба

**Interfaces:**
- Produces: `Button` (варианты icon/text, `use:ripple`), `Scrollable` (Solid-обёртка
  над нашей механикой скролла).

Перед реализацией сверить: у нас уже есть императивные `components/button.ts` и
`components/scrollable.ts`. Порт — ВТОРОЙ, самостоятельный рендер, как это уже сделано
для `Row`/`Section` в волне 2 (см. шапки `rowTsx.solid.tsx`, `section.solid.tsx` — там
записано, почему второй порт намеренный). Общий SCSS не дублировать.

- [ ] **Step 1:** пины на оба примитива (ripple вешается, скролл отдаёт свои ручки)
- [ ] **Step 2:** красный прогон
- [ ] **Step 3:** реализация
- [ ] **Step 4:** зелёный прогон + мутация (снять `use:ripple` → пин краснеет)
- [ ] **Step 5:** коммит `feat(solid): Button и Scrollable — примитивы хоста карточек`

---

### Task 3: хост карточек и оболочка карточки

**Files:**
- Create: `web-client/src/components/auth/AuthCardsHost.solid.tsx` (порт `tweb/src/pages/AuthCardsHost.tsx`, 243)
- Create: `web-client/src/components/auth/AuthCard.solid.tsx` (порт `tweb/src/pages/AuthCard.tsx`, 61)
- Create: тесты

**Interfaces:**
- Consumes: Task 1 (контекст, `matchCard`), Task 2 (`Button`, `Scrollable`)
- Produces: `AuthCardsHost` — фон, кнопки «назад»/тема, скролл, `<Transition mode="outin">`
  с семью `<Match keyed>`; `AuthCard` — `.card` + опциональный `.input-wrapper`.

Ключевая деталь, которую нельзя потерять: удержание предыдущей карточки на время
загрузки ленивого чанка — `children()` + `createMemo<JSX.Element>((prev) => cardChild() || prev)`
(`AuthCardsHost.tsx:227-230`), плюс `<Show>`-гейт перед `<Transition>`. Причина
расписана в докблоке оригинала `:174-195` — перенести и её.

- [ ] **Step 1:** пины: при переходе в контейнере НИКОГДА не бывает двух карточек;
  уходящая доигрывает до монтирования новой; на время загрузки ленивой карточки в DOM
  остаётся предыдущая, а не пустота.
- [ ] **Step 2:** красный прогон
- [ ] **Step 3:** реализация
- [ ] **Step 4:** зелёный + мутация (снять `mode="outin"` → пин «двух карточек не бывает» краснеет)
- [ ] **Step 5:** коммит `feat(auth): хост карточек входа на Solid`

---

### Task 4: карточки шага — номер, код, пароль

**Files:**
- Create: `cards/SignInCard.solid.tsx`, `cards/AuthCodeCard.solid.tsx`, `cards/PasswordCard.solid.tsx`
- Create: поля ввода на Solid — `CountryInput.solid.tsx`, `TelInput.solid.tsx`,
  `CodeInput.solid.tsx`, `InputField.solid.tsx`
- Create: тесты на каждую карточку

Источники: `tweb/src/pages/cards/SignInCard.tsx` (278), `AuthCodeCard.tsx` (343),
`PasswordCard.tsx` (250); поля — `tweb/src/components/inputField.ts` (843),
`codeInputField.tsx` (291), `countryInputField.ts` (306), `telInputField.ts` (137).

Сохранить наши работающие решения, у которых в оригинале нет предмета, и назвать их
в коде: страна по IP (`AuthFlow.test.tsx` пинит: пустой ответ оставляет `+7`, `DE` даёт
`+49`, тронутое поле ответом не перебивается), вход по ключу доступа
(`isWebAuthnSupported`/`getPasskeyAssertion`), подтверждения сброса аккаунта на
`PopupPeer`.

- [ ] Шаги: пины → красный → реализация → зелёный + мутация → коммит (по карточке отдельным коммитом)

---

### Task 5: карточки шага — регистрация, QR, восстановление, импорт

**Files:**
- Create: `cards/SignUpCard.solid.tsx`, `cards/SignQRCard.solid.tsx`,
  `cards/EmailRecoverCard.solid.tsx`, `cards/SignImportCard.solid.tsx`
- Create: `QrCode.solid.tsx`, `MediaHeader.solid.tsx`, `AuthButton.solid.tsx`,
  `Preloader.solid.tsx`, `emailPattern.solid.tsx`, `superFormatter.solid.tsx`
- Create: тесты

Источники: `tweb/src/pages/cards/SignUpCard.tsx` (181), `SignQRCard.tsx` (245),
`EmailRecoverCard.tsx` (92), `SignImportCard.tsx` (80).

Особое внимание — таймеры QR: ротация токена и опрос подтверждения живут В КАРТОЧКЕ и
снимаются вместе с ней (`SignQRCard.tsx:2-3` нашей версии). В Solid это `onCleanup`, а не
`useEffect`-возврат; пин обязан ловить, что после размонтирования опрос прекращён.

Перенести и наш спойлер маски почты (`emailPattern.test.tsx`, 92) — у него уже есть пины.

- [ ] Шаги: пины → красный → реализация → зелёный + мутация → коммит

---

### Task 6: точка монтирования, снос React-версии, сканы

**Files:**
- Modify: `web-client/src/App.tsx:235` (ветка `authed ? <Shell/> : <AuthFlow/>`)
- Create: `web-client/src/components/auth/mountAuthFlow.solid.tsx` (порт `tweb/src/pages/mountAuthFlow.tsx`, 91)
- Delete: `components/auth/AuthFlow.tsx` и все React-карточки/поля, заменённые задачами 3–5
- Modify: `components/auth/AuthFlow.test.tsx`, `emailPattern.test.tsx` — на Solid-рантайм
- Modify: `core/hooks/useAuthGate.test.tsx` (упоминает уход на `AuthFlow`),
  `core/accountTransition.test.ts` — сверить, не сломались ли

**Это и есть DoD п. 14.** Пин, который его стережёт: скан по `web-client/src` —
после этапа не должно остаться ни одного React-файла в `components/auth/`.
Скан писать ДО удаления и увидеть красным.

- [ ] **Step 1:** написать скан-пин «в `components/auth/` React не осталось», увидеть красный
- [ ] **Step 2:** перевести монтирование на `SolidIsland`/`mountSolid`
- [ ] **Step 3:** удалить React-версию целиком
- [ ] **Step 4:** перевести существующие тесты; `npx vitest run && npx tsc --noEmit && npx vite build`
- [ ] **Step 5:** коммит `refactor(auth)!: экран входа на Solid, React-версия снесена`

---

### Task 7: живая проверка и документация

- [ ] **Step 1:** поднять стенд по `STAND.md`. **Пересобрать бэкенд вместе с фронтом** —
  образ на стенде отстаёт и отдаёт старую проводную форму, из-за чего вход падает на
  «Invalid code» при `200` от сервера (проверено 2026-09-03).
- [ ] **Step 2:** прощёлкать: вход по номеру и коду; неверный код; облачный пароль;
  восстановление по почте; QR (в т.ч. что опрос прекращается при уходе с карточки);
  регистрация нового номера; переход между аккаунтами; вход по ключу доступа.
  Числа «что было / что стало» — в тело коммита (DoD п. 10).
- [ ] **Step 3:** обновить `docs/superpowers/specs/2026-08-28-solid-migration-design.md`
  (§ 8 — отметить этап), при необходимости `web-client/CLAUDE.md`.
- [ ] **Step 4:** коммит `docs(solid): этап 1 волны 3 — экран входа`

## Что НЕ входит в этот этап

Профиль (`UserInfoPanel.tsx`, 826) и shared media (`SharedMedia.tsx`, 815) — этапы 2 и 3
волны 3, со своими планами. Их порт тянет за собой класс `PeerProfileAvatars` (974),
`AppSearchSuper` (2843) и хук `useCollapsable` (209), которых у нас нет вовсе, — это
отдельный разговор, и мешать его со сменой рантайма экрана входа нельзя.

Отдельно записан долг, найденный при разведке и к этапу не относящийся:
`components/userInfo/helpers.ts:24-37` — `countLabel` переключается по старым английским
именам вкладок, а зовётся с `LangPackKey`; ни один `case` не совпадает, подпись залитой
шапки профиля всегда голое число. Плюс `plural`/`membersLabel`/`chatsLabel` (`:7-18`)
несут жёстко зашитые русские строки мимо i18n. Чинить в этапе 2.
