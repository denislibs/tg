# `useImperativeIsland.ts` — снятие `strays`-уборки не красит собственный
# тест-сьют хука

**Статус:** открыт, пробел в тестах ОБЩЕГО хука (`core/hooks/
useImperativeIsland.ts`), не периметр панели профиля — заведён по находке
ревью задачи 5 волны «шапка профиля классом PeerProfileAvatars»
(раунд правок 3, 2026-09-05).

## Что это

`useImperativeIsland.ts:136` (`mode: 'host'` + `strays`, teardown):

```ts
else if (strays) host.querySelectorAll(strays).forEach((el) => el.remove())
```

Единственный тест хука на `strays` — `useImperativeIsland.test.tsx`, describe
«strays убирает узлы, досыпанные в host (случай .sticky_sentinel)»:

```ts
const { container, rerender } = render(
  <Show><Host setup={setup} options={{ strays: '.sticky_sentinel' }} /></Show>,
)
expect(container.querySelectorAll('.sticky_sentinel')).toHaveLength(1)

rerender(<Show visible={false}>...</Show>) // размонтирует Host ЦЕЛИКОМ
expect(container.querySelectorAll('.sticky_sentinel')).toHaveLength(0)
```

## Причина, почему мутация не красит его

`rerender` с `visible={false}` убирает `<Host>` из дерева ЦЕЛИКОМ — вместе с
ним из `container` пропадает и сам host-узел (`data-testid="host"`), и его
дети, включая сентинел. Проверка идёт через `container.querySelectorAll(...)`
— она видит «сентинела больше нет» ОДИНАКОВО что при реальной работе
`strays`-уборки, что при её ПОЛНОМ отсутствии: React убирает host-узел из
`container` сам по себе, утаскивая с собой ЛЮБЫХ детей, включая тех,
которых React не рендерил (appendChild'ом добавленных vanilla-кодом) — ведь
удаление РОДИТЕЛЯ из DOM снимает с ним всё поддерево, независимо от того,
кто и когда добавил туда детей.

Проверено фактически (задача 5, раунд правок 1): закомментировал строку
`useImperativeIsland.ts:136` — весь `useImperativeIsland.test.tsx` остался
ЗЕЛЁНЫМ (мутация не покрыта ни одним из его тестов), а
`UserInfoPanel.avatarsCollapse.test.tsx` (новый тест панели профиля,
задача 5) СРАЗУ дал RED: `1 failed | 3 passed`, `.profile-avatars-container`
остался в DOM после размонтирования.

Тест панели красит, потому что держит ССЫЛКУ НА HOST-УЗЕЛ, ВЗЯТУЮ ДО
РАЗМОНТИРОВАНИЯ (`const host = getByTestId('host')`), и после
`rerender(...mounted={false})` проверяет `host.querySelector(...)` — у
ОТСОЕДИНЁННОГО от документа, но всё ещё живого в памяти узла. Если `strays`
не отработал, чужой ребёнок остаётся ребёнком ИМЕННО ЭТОГО host-узла в
памяти — и `querySelector` находит его, даже когда host уже не часть
`document`. Тест хука так не делает: он смотрит `container.querySelectorAll`,
то есть «виден ли узел документу», а не «жив ли ребёнок ВНУТРИ конкретного
host-узла, который мог утащить с собой мусор».

## Что делать

Дописать `useImperativeIsland.test.tsx`, describe «strays…», КЕЙС на
структуру, а не на видимость из `container`: сохранить ссылку на host ДО
`rerender`/`unmount`, и после — проверять `host.querySelector(strays)` У
СОХРАНЁННОЙ ссылки (по образцу `UserInfoPanel.avatarsCollapse.test.tsx`,
теста «размонтирование: узел класса уходит из DOM…»). Мутация (снятие строки
`useImperativeIsland.ts:136`) обязана красить этот новый кейс ФАКТИЧЕСКИ —
проверить тем же приёмом, что и здесь (закомментировать строку, прогнать,
убедиться в красном, откатить).

**Затрагиваемые файлы:**
- `web-client/src/core/hooks/useImperativeIsland.ts:136` (`strays`-уборка) — сама строка.
- `web-client/src/core/hooks/useImperativeIsland.test.tsx` — тест-сьют, которому не хватает кейса.
