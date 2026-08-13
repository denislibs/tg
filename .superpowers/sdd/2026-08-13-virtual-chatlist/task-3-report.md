# Task 3: `LoadingDialogSkeleton` — отчёт

## Статус: DONE

## Файлы

- `web-client/src/components/virtual/LoadingDialogSkeleton.tsx` (create)
- `web-client/src/components/virtual/LoadingDialogSkeleton.module.scss` (create)
- `web-client/src/components/virtual/LoadingDialogSkeleton.test.tsx` (create)

## Что сделано

Порт `tweb/src/components/loadingDialogSkeleton.tsx` (56 строк) +
`loadingDialogSkeleton.module.scss`, прочитаны целиком. Solid-компонент
(`createSignal`/`onCleanup`) переведён на React (`useState`/`useEffect`) —
никакой другой формы порта интерфейс не требовал.

Интерфейс — как задан в брифе:
```ts
export type LoadingDialogSkeletonSize = 72 | 64
const LoadingDialogSkeleton: React.FC<{
  className?: string
  style?: React.CSSProperties
  noAvatar?: boolean
  size: LoadingDialogSkeletonSize
  seed: number
}>
```

Формула ширины плашки — дословно из оригинала (`loadingDialogSkeleton.tsx:6-11`):
```ts
const x = Math.sin(seed * 10000 + 999999) * 10000
const rand = x - Math.floor(x)
return min + rand * (max - min)
```
с диапазонами `100..120` / `20..60` / `60..200`, все через `| 0` — как в оригинале.

Разметка сохранена буквально: `Avatar` рендерится ВСЕГДА (не условно), видимость
переключает CSS-класс `noAvatar` (`.noAvatar .Avatar { display: none }`) — так же,
как в Solid-оригинале (`classList`, не условный JSX), чтобы не расходиться с
`.module.scss`, где скрытие уже завязано на класс.

Корневой класс `loading-dialog-skeleton` — обязателен (под него уже лежит
collapsed-режимное правило `_leftSidebar.scss:100-102`), присутствует всегда.

SCSS — геометрия 1:1: `padding: 16px 16px 16px 9px`, аватар `54px`/`48px` под
`.size72`/`.size64`, `margin-right: 14px`, `gap: 18px`, плашки `height: 10px` +
`border-radius: 1000px`, `mask-size: 200% 100%`,
`animation: shimmer 2.25s infinite linear`, `mask-position` `50% 0` → `-150% 0`.

Миксин `animation-level-global` оригинала — нашёл эквивалент грепом
`animation-level` по `src/styles/`: `src/styles/mixins/_animationLevel.scss:8`
(`@mixin animation-level-global($level: 2)`, гейт `body.animation-level-2`,
дефолт `2`, как в оригинале), уже используется 40+ раз в проектных
`*.module.scss` (`AddContactView`, `StoriesRow`, `Sidebar`, …). Подключил через
`@use '../../styles/mixins' as *`.

Цветовая переменная `var(--background-color)` оригинала (в миксине `common`) —
живой CSS-var в проекте (не выдумка): используется в `Sidebar.module.scss`,
`UserInfoPanel.module.scss`, вендорном `components/chatlist/dialogsPlaceholder.ts`
(тот самый canvas-скелетон, который спека прямо называет соседом этого
компонента — «tweb использует ОБА»). Оставлена без замены.

## Тесты (`LoadingDialogSkeleton.test.tsx`, 9 шт.)

1. `seed=0` и `seed=7` — три ширины (`TitleLeft`/`TitleRight`/`Subtitle`) сверены
   с той же формулой, пересчитанной независимо в тесте, через
   `style.getPropertyValue('--width')`.
2. разные seed дают разные ширины (сравнение снимков `seed=0` vs `seed=7`).
3. `size=72`/`size=64` — разные классы размера на корне, взаимоисключающие.
4. класс `loading-dialog-skeleton` на корне присутствует.
5. `noAvatar` — класс `noAvatar` на корне появляется/не появляется.
6. shimmer-класс не появляется до 1499 мс и появляется на 1500 мс
   (`vi.useFakeTimers` + `act(vi.advanceTimersByTime)`).
7. размонтирование до 1500 мс вызывает `clearTimeout` (шпион на
   `globalThis.clearTimeout`) — мутация «убрать `clearTimeout` из cleanup»
   прогнана вручную: `AssertionError: expected "clearTimeout" to be called at
   least once`, тест красный; после отката — снова зелёный (9/9).

## Прогон

```
npx vitest run src/components/virtual/
 Test Files  2 passed (2)   # мой + __perfcheck2.test.ts соседнего агента
      Tests  14 passed (14)

npx tsc --noEmit   # exit 0, ошибок нет во всём проекте на момент прогона
npx oxlint src/components/virtual/LoadingDialogSkeleton.tsx src/components/virtual/LoadingDialogSkeleton.test.tsx
 # без вывода — чисто
```

## Сомнения / для координатора

Нет. Единственное решение вне буквы брифа — рендерить `Avatar`-див всегда
(не условно по `noAvatar`), как в Solid-оригинале; альтернатива (условный
рендер) дала бы тот же видимый результат, но разошлась бы с SCSS-селектором
`.noAvatar .Avatar` и с точным повторением DOM-формы оригинала.
