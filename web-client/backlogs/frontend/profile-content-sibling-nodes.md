# `PinnedStoriesSection` — сиблинг `.profile-content`, а не его ребёнок

**Статус:** открыт, объявленное отступление (не баг). Второй узел этого
бэклога — React-фолбэк инвайт-ссылки — **закрыт задачей 13 плана shared media**
(`docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`): строка
портирована в Solid-`Link` веткой `exported_invite` оригинала
(`peerProfile.solid.tsx`, проп `exportedInviteUrl`), React-сиблинга больше нет.
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-card-solid.md`, финальное ревью ветки (после задач
2-6); сужен 2026-09-07.
**Контекст:** `web-client/src/components/UserInfoPanel.tsx` —
`<PinnedStoriesSection>` стоит ПОСЛЕ `<div ref={profileContentHostRef} />`
(хост Solid-корня `.profile-content`), то есть в DOM — сиблинг хоста, а не
потомок самого `.profile-content`.

## Почему это не только косметика

`.search-super` (узел класса `AppSearchSuper`, последний ребёнок
`.profile-content`) стоит `position: absolute; top: 100%` от корня
(`_rightSidebar.scss:89-92`). Любой React-сиблинг ПОСЛЕ хоста корня попадает
в поток ровно на то же место и оказывается ПОД абсолютным узлом шаред-медиа —
так до задачи 13 была не видна строка инвайт-ссылки под липким рядом вкладок.
`PinnedStoriesSection` рендерит `null`, пока у пира нет закреплённых историй,
поэтому сегодня симптома нет; появится — секция окажется под вкладками.

## Что в tweb

У оригинала (`peerProfile.tsx:194-214`) ВСЁ содержимое карточки — прямые дети
`.profile-content`; истории профиля — не секция, а ВКЛАДКА ряда шаред-медиа
(`stories`, `stories/profileList.tsx`), с приоритетом первой открытой.

## Что делать

Предмет — задача 19 плана shared media («Истории вкладкой ряда вместо отдельной
секции»): портировать вкладку `stories` в `AppSearchSuper`, после чего
`PinnedStoriesSection` уходит целиком. Промежуточный вариант (узел-проп в
Solid-корень + React-портал, как раньше делалось для `searchSuperContainer`)
оправдан только если симптом проявится раньше задачи 19.

**Критерий готовности:** `PinnedStoriesSection.tsx` снесён, истории — вкладка
ряда `AppSearchSuper`.
