# Task 2: `useAnimatedTop` — порт `createAnimatedValue` — отчёт

## Статус: DONE

## Файлы

- `web-client/src/components/virtual/useAnimatedTop.ts` (create)
- `web-client/src/components/virtual/useAnimatedTop.test.ts` (create)

## Что сделано

Порт `tweb/src/helpers/solid/createAnimatedValue.ts` (47 строк, прочитан целиком).
Формула прогресса/значения взята 1:1 (`createAnimatedValue.ts:25,27`):

```
progress = easing(min(1, (performance.now() - startTime) / time))
current  = (target - startValue) * progress + startValue
```

`time = 120` — константа хука (в оригинале параметр вызова; у списка чатов вызывается
всегда с 120, `deferredSortedVirtualList.tsx`).

Интерфейс — как задан в брифе:
```ts
export function useAnimatedTop(top: number, canAnimate: boolean): (el: HTMLElement | null) => void
```

Ключевое отличие порта (спека, «Форма порта», отступление №2): значение НЕ идёт через
React-состояние. `current`/`animating` оригинала — solid-сигналы, которые реактивно кладёт
в DOM потребитель (JSX). В React так анимировать нельзя — сигнал тикал бы 60 раз/сек и на
каждый тик перерисовывал бы всю строку списка. Поэтому:
- значение анимации живёт в `useRef` (`currentRef`), не в `useState`;
- каждый кадр `animate()` (уже вендоренный `helpers/animation.ts`) пишет `el.style.top`
  и `--background` **прямо в DOM**, минуя React re-render;
- хук отдаёт стабильный (не меняющий идентичность между рендерами — иначе React дёргал бы
  detach/attach ref при каждой смене `top`) callback-ref; актуальные `top`/`canAnimate`
  читаются этим колбэком из ref (`topRef`), а не из замыкания.

`--background: var(--surface-color)` во время движения и `removeProperty` после — перенос
логики потребителя оригинала (`deferredSortedVirtualList.tsx:189-194`) внутрь хука, как
явно указано в брифе.

Первое присвоение узлу (монтирование) — без анимации, как `{defer: true}` у
`createEffect(on(...))` оригинала (`createAnimatedValue.ts:37-38`): эффект там не
срабатывает на начальное значение сигнала, только на его смену. В порте это выражено тем,
что callback-ref при первом attach сразу пишет `top` в DOM и синхронизирует `currentRef`
— эффект (React `useEffect([top, canAnimate])`) на этот же первый рендер молчит, потому что
`currentRef.current === top` уже верно.

Гашение анимации (`cleaned`-флаг оригинала, `createAnimatedValue.ts:20,23,33-35`) —
`stopRef`, срабатывает при: следующей смене `top`/`canAnimate` до завершения кадра, смене
DOM-узла и размонтировании (эффект-cleanup `useEffect`).

## Тесты (`useAnimatedTop.test.ts`, 5 шт., `renderHook` из `@testing-library/react`)

1. монтирование ставит `top` сразу, без промежуточных значений (проверено, что 200мс
   фейковых таймеров после монтирования ничего не сдвигают — эффекта на первый рендер нет).
2. смена `top` при `canAnimate=true` идёт от старого к новому: строго между на 112мс,
   и достигает цели к 128мс. Особенность фейковых таймеров vitest: `requestAnimationFrame`
   квантуется кадрами по 16мс (`16, 32, …, 112, 128, …` — эмпирически проверено отдельным
   прогоном), поэтому первый кадр с `(now-start) ⩾ 120` — это 128мс, не 120 ровно; тест
   продвигает таймер именно до 128, комментарий в файле это объясняет. Формула клампит
   `progress` в `min(1, …)`, так что при любой квантовке итоговое значение — ровно `target`,
   без овершута.
3. `canAnimate=false` ставит новое значение мгновенно.
4. `--background` стоит во время движения (`var(--surface-color)`) и снят
   (`getPropertyValue === ''`) после завершения.
5. размонтирование гасит анимацию — значение застывает (мутация: убрать `return () => {...}`
   cleanup из `useEffect` — тест красный: `AssertionError: expected '100px' to be
   '83.357097px'`; вторая проверенная мутация — вырезать ветку `!canAnimate` — падают 3
   теста).

Обе мутации прогнаны вручную (правка → `vitest run` красный вывод → возврат), не пересказаны.

## Прогон

```
npx vitest run src/components/virtual/
 Test Files  1 passed (1)
      Tests  5 passed (5)

npx tsc --noEmit   # exit 0, ошибок нет во всём проекте (в т.ч. в файлах соседнего агента —
                     на момент этого прогона они были чисты)
npx oxlint src/components/virtual/useAnimatedTop.ts src/components/virtual/useAnimatedTop.test.ts
 # без вывода — чисто
```

## Сомнения / для координатора

Нет. Интерфейс, формула и константа `time=120` взяты буквально по брифу и оригиналу;
отступление (React-ref вместо solid-сигнала) — то самое, что предписано спекой и брифом.
