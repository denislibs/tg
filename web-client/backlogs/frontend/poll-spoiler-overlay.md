# Оверлей спойлеров в ОПРОСЕ — второй потребитель `createMessageSpoilerOverlay`

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** 2026-09-06, ветка `fix/text-spoiler-particles` (оверлей частиц
в ленте чата). В саму задачу опросы не входили.
**Контекст:** `web-client/src/components/messages/messageSpoilerOverlay.ts` —
фабрика есть и работает; вызывателей у неё сейчас два (лента чата и React-`RichText`),
а в оригинале три.

## Что в tweb

Оверлей частиц вешается не только на тело сообщения, но и на **вопрос опроса** —
`src/components/chat/bubbleParts/pollMessageContent/utils.ts:59-74`:

```ts
(async() => {
  await Promise.all(unwrap(props.loadPromises) || []);
  if(isCleaned() || !descriptionElement.querySelector('.spoiler-text')) return;

  const spoilerOverlay = createMessageSpoilerOverlay({
    mid: props.message.mid,
    messageElement: descriptionElement,        // ← узел ВОПРОСА, не `.message`
    animationGroup: props.animationGroup || 'none'
  }, HotReloadGuard);

  descriptionElement.append(spoilerOverlay.element);
  cleanup = () => { spoilerOverlay.dispose(); };
})();
```

То есть механизм ТОТ ЖЕ, что у бабла (`bubbles.ts:9781-9799`), меняется лишь
хозяин узла: у опроса это элемент вопроса, а не тело сообщения.

## Чего не хватает у нас

1. **Узла-хозяина.** Оверлей ищет `.spoilers-container` от переданного
   `messageElement` (`messageSpoilerOverlay.ts`, ветки `styles/tweb/_spoiler.scss`).
   У tweb класс `spoilers-container` стоит на самом элементе вопроса; надо
   проверить, что наш рендер опроса его ставит, иначе фабрика вернёт `undefined`
   и вопрос останется на CSS-фолбэке.
2. **Точки вызова.** В нашем рендере опроса вызова `createMessageSpoilerOverlay`
   нет вовсе — как не было его и в ленте до этой задачи.

## Что делать

1. Найти наш узел вопроса опроса (аналог `descriptionElement`) и убедиться, что
   на нём есть `spoilers-container` + `.spoiler-text` из `wrapRichText`.
2. Позвать `createMessageSpoilerOverlay({ messageElement: <узел вопроса> })`,
   вставить `overlay.element` в него же и погасить `overlay.dispose()` там, где
   узел вопроса уходит (у tweb это `onCleanup` его Solid-компонента).
3. Пин: у опроса со спойлером в вопросе появляется `.message-spoiler-overlay`
   внутри узла вопроса, у опроса без спойлера — не появляется; снятие узла гасит
   задачу симуляции. Образец — `components/chat/bubbles.spoilerOverlay.test.ts`.

**Критерий готовности:** вопрос опроса со спойлером закрыт частицами, а не
серой плашкой, и раскрывается кликом через оверлей (CSS-фолбэк
`lib/spoiler/spoilerReveal.ts` при живом оверлее молчит).
