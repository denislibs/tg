# Фолбэк инвайт-ссылки и `PinnedStoriesSection` — сиблинги `.profile-content`, а не его дети

**Статус:** открыт, объявленное отступление (не баг). Живёт до того, как
появится готовый приём проброса React-контента внутрь Solid-корня по месту
(тот же, что уже есть для `searchSuperContainer`/`avatarsInfo`).
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-card-solid.md`, финальное ревью ветки (после задач
2-6).
**Контекст:** `web-client/src/components/UserInfoPanel.tsx` — узлы фолбэк-
ссылки (`SidebarSection` с `Row` инвайта, было `:726-749` на момент фиксации)
и `<PinnedStoriesSection>` (было `:756` на тот же момент) стоят ПОСЛЕ
`<div ref={profileContentHostRef} />` (хост Solid-корня `.profile-content`),
то есть в DOM — сиблинги хоста, а не потомки самого `.profile-content`.

## Что в tweb и что было на `main`

У оригинала (`peerProfile.tsx:194-214`) ВСЁ содержимое карточки — прямые дети
`.profile-content` (аватар, delimiter, секции, `searchSuperContainer`
последним). До переезда карточки на Solid (когда `.profile-content` целиком
рисовал React) обе эти строки — фолбэк-ссылка и `PinnedStoriesSection` —
ТОЖЕ были прямыми детьми того же React-узла `.profile-content`, то есть
структурно совпадали с оригиналом.

## Что стало

После задач 2-5 плана `.profile-content` рисует Solid (`peerProfile.solid.tsx`,
`PeerProfile`), смонтированный мостом `mountSolid` в пустой узел-обёртку
`profileContentHostRef` (см. докблок `peerProfile.solid.tsx` — «Хост — пустой
узел-обёртка», `render()` вставляет содержимое НАПРЯМУЮ в этот узел, без
дополнительной обёртки). Правило владения узла (план, шапка) запрещает
React писать ВНУТРЬ этого поддерева — поэтому строки, которым по контракту
tweb место среди детей `.profile-content` (фолбэк-ссылка — аналог
`PeerProfile.Link`-ветки без публичного username, `PinnedStoriesSection` —
аналог `StoryPreviews`/`PinnedGifts` области), физически остались там, где их
рисовал React ДО задачи 2 — прямыми детьми `.sidebar-content`, то есть теперь
СИБЛИНГАМИ хоста `.profile-content`, а не его потомками.

Визуально сегодня почти безвредно: медиа-грид и большинство CSS-правил
`_profile.scss` бьют либо по классам самих узлов, либо через
`.profile-container` (`setCollapsedOnRef`, охватывает и `.profile-content`, и
его текущих сиблингов одинаково), а не по descendant-селекторам конкретно от
`.profile-content` для ЭТИХ двух узлов. Тем не менее порядок сместился
относительно и оригинала, и `main`, и это расхождение раньше нигде не было
объявлено — находка финального ревью.

## Что делать

Единственный корректный приём — тот же мост, каким уже пробрасывается
`searchSuperContainer`/`avatarsInfo`: `UserInfoPanel.tsx` заводит ещё один
пустой DOM-узел (например, `fallbackLinkHost`/`pinnedStoriesHost`), кладёт
его пропом в `PeerProfile` (`peerProfile.solid.tsx` вставляет узел ребёнком
`.profile-content` в нужном месте — рядом с `MainSection`/после неё, как в
оригинале), а React портирует туда содержимое (`createPortal`), как уже
делает для `SharedMedia` → `searchSuperContainer`. Требует правки контракта
`PeerProfileProps`/`PeerProfileContextValue` (два новых опциональных поля) и
соответствующих тестов каркаса (`peerProfile.solid.test.tsx`, «Корень и
порядок детей»).

**Критерий готовности:** оба узла — потомки `.profile-content`, порядок среди
детей 1:1 с местом их аналога в оригинале (там, где он есть) или с прежним
React-порядком (там, где аналога нет).
