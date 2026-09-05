# useCollapsable — временный владелец React вместо Solid-компонента

**Статус:** открыт, объявленное отступление (не баг). Живёт до Solid-порта
шапки профиля.
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-avatars-class.md`, задача 4 (контракт сворачивания
`PeerProfileAvatars` под внешний `useCollapsable`), ревью 2026-09-05.
**Контекст:** `components/peerProfileAvatars.ts` — конструктор принимает
`unfold` ОБЯЗАТЕЛЬНЫМ параметром (находка финального ревью ветки, Minor, п.8:
был необязательным `unfold?: () => void` во время задачи 4, но задача 5
сделала его обязательным — единственный вызывающий, `UserInfoPanel.tsx`,
всегда передаёт реальный из `useCollapsable()`, временная ветка «клик БЕЗ
unfold разворачивает себя сам» снесена вместе со своим тестом); клик по
свёрнутой шапке зовёт его безусловно.

## Что в tweb

Хук `hooks/useCollapsable.ts` — на Solid (`createSignal`/`createEffect`) и
создаётся ПРЯМО В КОНСТРУКТОРЕ класса `PeerProfileAvatars` через `createRoot`
(`peerProfileAvatars.ts:322-348`):

```ts
createRoot((dispose) => {
  this.middlewareHelper.onDestroy(() => { dispose(); this.unfold = undefined })

  const {folded, unfold, fold} = useCollapsable({
    container: () => this.container,
    listenWheelOn: this.setCollapsedOn,
    scrollable: () => scrollable.container,
    disableHoverWhenFolded: false,
    shouldIgnore: () => this.uploadInProgress
  })

  this.unfold = unfold
  this.fold = fold

  createEffect(() => {
    if(this.hasNoPhoto && !folded()) { fold(); return }
    this.setCollapsed(folded())
  })
})
```

Класс — единственный владелец состояния сворачивания: он же создаёт хук, он
же держит `unfold`/`fold`, он же эффектом приводит DOM в соответствие.

## Чего нет у нас

Наш `core/hooks/useCollapsable.ts` (229 строк, порт того же файла) — **React-
хук** (`useState`/`useRef`, строка 21): он писался под первого потребителя,
React-компонент `components/StoriesRow.tsx`, и класс `PeerProfileAvatars` на
Solid не сидит (это обычный TS-класс, портированный императивно). Хук на
`useState` нельзя создать «внутри конструктора класса» — ему нужен React
render/effect cycle.

Поэтому задача 4 развела владение на два места:
- класс получает `unfold` уже ГОТОВОЙ функцией через конструктор (опционально
  — до задачи 5 его может не быть вовсе, тогда клик разворачивает сам, см.
  докблок поля `unfold` в `peerProfileAvatars.ts`);
- `fold` внутрь класса не заведён вовсе — у него сегодня нет вызывающего
  (единственный вызов в tweb — `showUploadProgress`, не портирован; реактивный
  гейт `hasNoPhoto && !folded() → fold()` — часть эффекта, которым владеет
  внешний React-компонент, а не класс);
- сам вызов `useCollapsable({...})` и связывающий эффект
  (`folded → setCollapsed`, аналог tweb createEffect :340-348) заведёт задача 5
  во ВНЕШНЕМ React-компоненте (обёртка правой панели, `useImperativeIsland`),
  собрав геттеры `scrollable`/`listenWheelOn`/`container` по списку в докблоке
  `peerProfileAvatars.ts` (шапка файла, раздел про сигналы хука).

Итог: на время до Solid-порта панели профиля владелец состояния сворачивания
живёт СНАРУЖИ класса, а не внутри него, как в оригинале — окно между «класс
знает, что он свёрнут» (`setCollapsed`/`isCollapsed`, DOM-классы на
`setCollapsedOn`) и «кто решает, когда сворачивать» (React-хук) физически
разнесено на два файла.

## Что делать

Свести к устройству оригинала можно только вместе с шагом 2 этапа 2
(Solid-порт `peerProfile.tsx`, следующий план после закрытия
`2026-09-05-profile-avatars-class.md`, см. её докблок «Место в программе»):

1. `PeerProfileAvatars` (или его Solid-обёртка) заводит `useCollapsable` сам —
   либо переносом самого класса на Solid-компонент, который может звать хуки
   реактивно (ближе к оригиналу), либо портом ВТОРОЙ, Solid-версии
   `useCollapsable` рядом с React-версией (StoriesRow остаётся на React-хуке,
   новый потребитель — на Solid-версии; расходиться в двух реализациях одного
   и того же алгоритма — цена, которую стоит явно взвесить против переноса
   `StoriesRow` тоже на Solid).
2. Как только выбор сделан — `fold` (сегодня не заведён вовсе, см. докблок
   поля `unfold`) заводится вместе с реальным вызывающим (`hasNoPhoto &&
   !folded() → fold()`), а не раньше: заводить его сейчас означало бы стаб без
   вызывающего.
3. Внешний React-эффект (задача 5) убирается, `setCollapsed` возвращается к
   `private` (вызывающий снова внутри класса — сам эффект хука), либо
   остаётся `public`, если Solid-обёртка тоже держит его СНАРУЖИ (решается
   вместе с пунктом 1).

**Критерий готовности:** ровно ОДИН механизм сворачивания в дереве, владелец
`useCollapsable` — тот же модуль/компонент, что рисует шапку профиля (как в
tweb), а не React-обёртка поверх императивного класса.
