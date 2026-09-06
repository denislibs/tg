# Кнопка «ещё» в панели быстрых реакций — не показывается

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** порт панели быстрых реакций, этап 1 из 3 (ветка
`feat/reactions-menu`), 2026-09-06.
**Контекст:** панель в контекстном меню сообщения портирована
(`web-client/src/components/chat/reactionsMenu.ts` ← tweb
`src/components/chat/reactionsMenu.ts`). В оригинале справа от семи реакций
стоит `button.btn-icon.btn-menu-reactions-more` (reactionsMenu.ts:184-190),
и она открывает ПОЛНЫЙ пикер — эмодзи-таб с топ/недавними реакциями и
кастом-эмодзи (`onMoreClick`, reactionsMenu.ts:384-493).

У нас кнопки нет: панель создаётся ровно в том режиме, который у оригинала
включает его собственная опция `noMoreButton` (reactionsMenu.ts:70, 88, 99,
184 — так же tweb гасит кнопку в просмотрщике историй,
`src/components/stories/viewer.tsx:1098`). Показывать кнопку без обработчика
нельзя, а обработчик недостижим — см. ниже.

## Чем именно заблокировано

1. **Нет подсистемы эмодзи-дропдауна.** `onMoreClick` строит
   `new EmojiTab({...})` (`src/components/emoticonsDropdown/tabs/emoji.ts`) и
   оборачивает его в `new EmoticonsDropdown({...})`
   (`src/components/emoticonsDropdown/index.ts`). Портов ни того, ни другого у
   нас нет; ближайшее — эмодзи-пикер композера, это отдельная подсистема с
   другим устройством.
2. **Нет топ- и недавних реакций на бэке.** `mainSets` пикера — это
   `loadReactions` (reactionsMenu.ts:363-383): `messages.getTopReactions` +
   `messages.getRecentReactions` (`appReactionsManager.ts:293-320`). У нас нет
   ни таблиц, ни ручек: `GET /reactions`
   (`backend/internal/adapter/delivery/http/router.go:311`) отдаёт ПЛОСКИЙ
   каталог без персонализации, а `recent_reactions` в модели — это «кто
   поставил» на конкретном сообщении (`backend/internal/domain/reaction.go:53`),
   другая сущность.
3. **Нет кастом-эмодзи-реакций по всей вертикали.** Отказ объявлен на бэке
   (`backend/internal/domain/mtmessage.go:1057-1058` — «reactionCustomEmoji не
   объявляется: кастом-эмодзи у нас нет»), на фронте нет `lib/customEmoji/
   {element,renderer}` (`web-client/src/lib/richtext/wrapRichText.ts:21-25`).
   Половина содержимого полного пикера — именно кастом-эмодзи
   (`onClick`, reactionsMenu.ts:396-441, ветка `reactionCustomEmoji`).

Из-за (2) и (3) полный пикер 1:1 недостижим даже при портированном
эмодзи-дропдауне: показывать в нём было бы нечего сверх тех же семи реакций,
которые уже стоят в панели.

## Что делать

Порядок: сначала (2) — ручки топ/недавних реакций на бэке (аналоги
`messages.getTopReactions`/`getRecentReactions` + сохранение недавних при
постановке), потом порт `EmojiTab`/`EmoticonsDropdown` (1), потом — включить
кнопку, убрав режим `noMoreButton` у вызова из контекстного меню, и портировать
`getReactionsOpenPosition` (tweb `contextMenu.ts:2220-2227`), который задаёт
прямоугольник открытия пикера. Кастом-эмодзи (3) — осознанное сужение: пикер
остаётся эмодзи-только, пока подсистемы нет.

**Затрагиваемые файлы:**
- `web-client/src/components/chat/reactionsMenu.ts` (ветки `render`/
  `onMoreClick`, опции `openSide`/`getOpenPosition` — сейчас не портированы);
- `web-client/src/components/chat/contextMenu.ts`
  (`getReactionsOpenPosition`, передача `getOpenPosition` в панель);
- бэкенд: новые ручки топ/недавних реакций + их хранение.

**Критерий готовности:** в панели восьмая ячейка — кнопка `down`, по клику
открывается пикер с вкладками «часто используемые» и «недавние», выбор в нём
ставит реакцию тем же путём, что выбор в самой панели.
