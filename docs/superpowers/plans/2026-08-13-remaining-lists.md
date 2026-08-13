# Остальные списки на ядро виртуализации — план (этап 4)

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: `superpowers:subagent-driven-development`.

**Цель:** перевести на ядро этапа 3 три списка — архив (72), темы форума
(64, `noAvatar`), избранное (72, `extraPaddingBottom: 0`).

**Спека:** `docs/superpowers/specs/2026-08-13-remaining-lists-design.md` — читать
перед началом. Там же поправка к родительской спеке: `SearchView` в tweb через
это ядро НЕ идёт, его не трогаем.

## Global Constraints

- **Отвечать по-русски**, комментарии в коде — по-русски.
- **Референс — tweb** (`/Users/denisurevic/Documents/tweb`); у каждого порта —
  комментарий со ссылкой `файл:строка` оригинала.
- **Мёртвый код удалять** агрессивно.
- **Норма тестов:** строка проводки без теста, чья мутация краснеет, —
  нарушение. Проверять буквально: сломать строку, убедиться, что тест
  краснеет, вернуть.
- **Внешний вид не меняется.** Задача — механика рендера, а не редизайн: те же
  строки, те же отступы, то же пустое состояние.
- Константы из tweb, совпадающие буквально: архив `itemSize: 72`
  (`sidebarLeft/tabs/archivedTab.tsx`); темы `itemSize: 64, noAvatar: true`,
  класс контейнера `topic-dialogs-override` (`forumTab/groupForumTab.ts:23-32`);
  избранное `itemSize: 72, extraPaddingBottom: 0` (`appSearchSuper.ts:1897-1907`).
- Рабочая директория — worktree
  `/Users/denisurevic/Documents/messenger-denis/.claude/worktrees/dialogs-virtual-list`.
- Прогон: `cd web-client && npx vitest run --reporter=dot` и `npx tsc --noEmit`.

## Структура файлов

| Файл | Что делаем |
|---|---|
| `web-client/src/components/Sidebar.tsx` (+ `.module.scss`) | оверлей архива — на виртуальный список |
| `web-client/src/components/TopicsPanel.tsx` (+ `.module.scss`) | видимые темы — на виртуальный список; `renderRow` → мемо-компонент `TopicRow` |
| `web-client/src/components/userInfo/SharedMedia.tsx` | список избранного — на виртуальный список |

---

### Task 1: архив на виртуальный список

**Файлы:**
- Modify: `web-client/src/components/Sidebar.tsx:339-347`, `Sidebar.module.scss:126-141`
- Test: дополнить существующий тест сайдбара или создать `Sidebar.archive.test.tsx`

**Интерфейсы:**
- Consumes: `DeferredSortedVirtualList` из этапа 3 (точную сигнатуру взять из
  `web-client/src/components/virtual/DeferredSortedVirtualList.tsx`, не из плана —
  план мог разойтись с кодом).
- Produces: ничего для следующих задач.

**Оригинал:** `/Users/denisurevic/Documents/tweb/src/components/sidebarLeft/tabs/archivedTab.tsx`
— посмотреть, чем архивная вкладка отличается от основного списка (там тот же
`AutonomousDialogList`, но с `FOLDER_ID_ARCHIVE`).

**Осторожно:**
1. У архива НЕТ закреплённых элементов и НЕТ пагинации: `totalCount = items.length`,
   `isEnd = true`, `requestItemForIdx` — no-op. Ядро это допускает; убедиться,
   что оно не начинает дёргать загрузку.
2. `.archiveList` сейчас сам себе скроллер (`overflow-y: auto`). Он и станет
   `scrollableHost` для виртуального списка — но `ul` внутри должен получить
   геометрию списка, а не растягиваться контентом. Сверить с тем, как это
   сделано у основного списка после этапа 3.
3. Пустое состояние («No archived chats») остаётся и рендерится ВМЕСТО списка,
   а не внутри `ul`.
4. Строки — те же `ChatListItem` с теми же пропсами, включая `selected` и
   `onSelect`.

- [ ] **Шаг 1: тесты** — 300 архивных чатов: в DOM только видимые строки, а не
  300; `ul` несёт высоту `300*72+8`; пустой архив показывает заглушку и не
  рендерит `ul`; клик по строке зовёт `onSelect` с тем же id, что раньше.
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run --reporter=dot && npx tsc --noEmit`
- [ ] **Шаг 5: коммит** — `feat(archive): архивный список на виртуальное ядро`

---

### Task 2: темы форума на виртуальный список

**Файлы:**
- Modify: `web-client/src/components/TopicsPanel.tsx` (+ `.module.scss`)
- Test: `web-client/src/components/TopicsPanel.test.tsx` (создать или дополнить)

**Интерфейсы:**
- Consumes: `DeferredSortedVirtualList` (этап 3).
- Produces: мемоизированный компонент `TopicRow` (экспортировать из того же
  файла или соседнего — на усмотрение, но он обязан быть `memo`).

**Оригинал:** `/Users/denisurevic/Documents/tweb/src/components/forumTab/groupForumTab.ts:20-40` —
`itemSize: 64`, `noAvatar: true`, контейнеру ставится класс
`topic-dialogs-override`.

**Осторожно:**
1. **Виртуализируется ТОЛЬКО список видимых тем.** Сворачиваемая секция скрытых
   тем остаётся обычным потоком под ним — у неё свой заголовок-раскрывашка, а
   ядро умеет только однородные строки фиксированной высоты. Это записано в
   спеке как осознанное отступление; продублировать комментарием в коде.
2. **`renderRow` — функция ВНУТРИ тела `TopicsPanel`** (`TopicsPanel.tsx:125-172`),
   то есть все строки пересоздаются на каждый рендер панели. Вынести в
   отдельный `memo`-компонент `TopicRow` — иначе мемоизация окна не работает и
   виртуализация не даёт ничего. Пропсы подобрать так, чтобы они были
   стабильны (колбэки — через `useCallback`, не инлайн-стрелки).
3. Высота строки — `64px` (`TopicsPanel.module.scss:37-50`, `min-height: 64px`,
   комментарий там же ссылается на tweb `.topic-dialogs-override .chatlist-chat`).
   Проверить, что после виртуализации фактическая высота ровно 64: с
   `position: absolute` `min-height` больше не «дотягивает» строку в потоке.
   При расхождении — привести стиль, а не подгонять `itemSize`.
4. Класс `topic-dialogs-override` — проверить грепом, есть ли под него стили в
   `web-client/src/styles/tweb/`. Если нет — привезти из tweb вместе с
   переносом; если есть, но мёртвые — оживить.
5. `noAvatar: true` относится к скелетону (у тем нет аватара).
6. Данные тем — локальный `useState` + RPC `managers.groups.listTopics(chatId)`,
   без пагинации: `totalCount = visible.length`, `requestItemForIdx` — no-op.

- [ ] **Шаг 1: тесты** — 200 тем: в DOM только видимые; фактическая высота
  строки 64; скелетон без аватара; секция скрытых по-прежнему в потоке и
  раскрывается; `TopicRow` не перерисовывается при скролле, если её данные не
  изменились (счётчик рендеров); поиск по темам по-прежнему фильтрует.
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run --reporter=dot && npx tsc --noEmit && npx eslint src`
- [ ] **Шаг 5: коммит** — `feat(topics): панель тем форума на виртуальное ядро`

---

### Task 3: избранное на виртуальный список

**Файлы:**
- Modify: `web-client/src/components/userInfo/SharedMedia.tsx`
- Test: дополнить тесты `SharedMedia`/`UserInfoPanel` или создать новый

**Интерфейсы:**
- Consumes: `DeferredSortedVirtualList` (этап 3).

**Оригинал:** `/Users/denisurevic/Documents/tweb/src/components/appSearchSuper.ts:1890-1935`
(`loadSavedDialogs`) — `itemSize: 72`, `extraPaddingBottom: 0`.

**Осторожно:**
1. `extraPaddingBottom: 0` — буквально из оригинала (`:1906`): список вложен в
   панель профиля, лишние 8px снизу там не нужны. Высота `ul` = `count * 72`,
   БЕЗ `+8`. Зафиксировать тестом — это единственное, чем этот список
   отличается по геометрии.
2. Список приезжает одним RPC (`useSavedDialogs` → `managers.chats.savedDialogs()`),
   пагинации нет: `totalCount = items.length`, `isEnd = true`,
   `requestItemForIdx` — no-op.
3. `SharedMedia` — вкладочный компонент; убедиться, что виртуальный список
   получает правильный `scrollableHost` (скроллер панели профиля, а не окна) и
   что при переключении вкладок он корректно размонтируется.
4. Пустое состояние сохранить.

- [ ] **Шаг 1: тесты** — 150 записей: в DOM только видимые; высота `ul` = `150*72`
  ровно (мутация: вернуть `+8` — тест краснеет); пустой список показывает
  прежнюю заглушку; переключение вкладки не оставляет висящих слушателей скролла.
- [ ] **Шаг 2: убедиться, что тесты падают.**
- [ ] **Шаг 3: реализация.**
- [ ] **Шаг 4:** `npx vitest run --reporter=dot && npx tsc --noEmit && npx eslint src`
- [ ] **Шаг 5: коммит** — `feat(saved): список избранного на виртуальное ядро`

---

### Task 4: пин к поправке — `SearchView` не виртуализируем

**Файлы:**
- Test: `web-client/src/components/searchNotVirtualized.test.ts` (создать)

**Зачем:** родительская спека ошибочно называла `SearchView` потребителем ядра;
поправка обоснована в спеке этапа 4 (в tweb `itemSize: 72` в `appSearchSuper`
относится к вкладке «Избранное», а обычные результаты поиска идут секциями с
заголовками и медиа-гридом, которые ядро фиксированной высоты не умеет). Без
пина следующий подход «допишет» его по инерции.

- [ ] **Шаг 1: тест-скан** — `src/components/SearchView.tsx` не импортирует
  `components/virtual/`; в сообщении об ошибке — ссылка на раздел «Поправка к
  родительской спеке» в `docs/superpowers/specs/2026-08-13-remaining-lists-design.md`
  и одна строка почему. Образец скана по исходникам —
  `src/stores/noManualOrder.test.ts:76-84`.
- [ ] **Шаг 2: убедиться, что скан краснеет** на временно добавленном импорте.
- [ ] **Шаг 3: коммит** — `test(search): пин — результаты поиска не идут через ядро виртуализации`
