# Ванильная лента не знает больших эмодзи (`emoji-big`)

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** 2026-09-06, ветка `fix/channel-post-classes`. Найден при
разборе заглушки `STUB_CTX` (`components/chat/bubbles.ts`): вместе с
захардкоженным «это канал» там врёт и `bigEmojiCount: 0`. Первое поле починено
задачей (гейт поста переехал на `message.views`), второе — этот долг.
**Контекст:** `components/chat/bubbles.ts::STUB_CTX` → `classesFor` →
`components/messages/bubbleClasses.ts`.

## Что в tweb

Сообщение из ОДНИХ эмодзи рисуется как стикер, а не как текстовый бабл.

Детект — `bubbles.ts:7357-7382`: считаются сущности `messageEntityEmoji` /
`messageEntityCustomEmoji`, и если их суммарная длина равна длине текста без
пробелов (`emojiStrLength === strLength`, `:7373` — ограничения «не больше
трёх» в живом исходнике закомментировано), то

```ts
bigEmojis = Math.min(BIG_EMOJI_SIZES_LENGTH, emojiEntities.length);   // :7374
const size = BIG_EMOJI_SIZES[bigEmojis];
if(size) bubble.style.setProperty('--emoji-size', size + 'px');       // :7381
```

Дальше (`:7510-7538`):

* один эмодзи и есть анимированный стикер под него → бабл превращается в
  СТИКЕР (`getAnimatedEmojiSticker`, `:7513-7519`);
* иначе текст уезжает в `div.attachment.spoilers-container` (`:7522-7527`);
* бабл получает `emoji-big` (`:7531`), становится `isStandaloneMedia`,
  `canHaveTail = false`, `isMessageEmpty = true`;
* класс `can-have-big-emoji` вешается в любом случае (`:7537`).

## Чего нет у нас

Ванильная лента считает `bigEmojiCount` НУЛЁМ всегда (`STUB_CTX`), поэтому
`bubbleClasses` не ставит ни `emoji-big`, ни `can-have-big-emoji`, ни `sticker`
и не уводит бабл в `is-message-empty`/`just-media`. Сообщение из одних эмодзи
рисуется обычным текстовым баблом мелким шрифтом — расхождение видно глазом.

Сам ДЕТЕКТ у нас уже написан, но живёт в React-компоненте:
`components/RichText.tsx::emojiOnlyCount` (документирован по тому же
`bubbles.ts:7373`). Лестницы размеров (`BIG_EMOJI_SIZES`) и подмены на
анимированный стикер эмодзи нет вовсе.

## Что делать

1. Вынести `emojiOnlyCount` из `RichText.tsx` в общее место (`core/…`), чтобы
   им пользовалась и лента, а не только React-компонент.
2. В `renderMessage` ленты считать `bigEmojis` по правилу оригинала
   (`bubbles.ts:7357-7374`) и передавать в `bubbleClasses` вместо заглушки —
   вместе с `--emoji-size` на самом бабле (`:7381`).
3. Портировать ветку рендера `:7510-7538`: `div.attachment.spoilers-container`
   с текстом, `emoji-big` + `can-have-big-emoji`, отмена хвоста.
4. Подмена одиночного эмодзи анимированным стикером (`:7513-7519`) — отдельным
   шагом: у нас нет `getAnimatedEmojiSticker`, набор анимированных эмодзи
   должен приехать с бэкенда.

**Критерий готовности:** бабл сообщения `😀` несёт `emoji-big`,
`can-have-big-emoji`, `sticker`, `is-message-empty`, `just-media` и не несёт
`can-have-tail`; тест ленты пинует и обратное — текст с эмодзи И буквами
остаётся обычным баблом.
