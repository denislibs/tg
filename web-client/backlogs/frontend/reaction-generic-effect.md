# Универсальная («generic») анимация эффекта реакции — не портирована

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** починка задержки эффекта реакции (ветка
`fix/reaction-effect-latency`), 2026-09-06.
**Контекст:** `web-client/src/components/chat/reactions.ts::fireAroundAnimation`
— порт tweb `ReactionElement.fireAroundAnimation`
(`src/components/chat/reaction.ts:1124-1290`, `onEmoticon` :1474-1519).

## Что именно не портировано

Развилка оригинала `reaction.ts:1484-1490`:

```ts
const isEffectLoaded = docs.every((doc) => {
  const cacheContext = apiManagerProxy.getCacheContext(doc);
  return !!(cacheContext.downloaded || cacheContext.url);
});
if(isEffectLoaded || !docs.length) {
  return onAvailableReaction({availableReaction, onlyAround});
}
// * the reaction effect isn't loaded yet - play a generic animation
docs.forEach(warmUpDownload);
```

На промахе кэша оригинал НЕ ждёт каталожные файлы: он играет generic-эффект —
случайную анимацию из набора `inputStickerSetEmojiGenericAnimations`
(`appReactionsManager.ts:983-1010`), у которой покадровый рендер подменён
(`overrideRender`, `reaction.ts:1362-1436`): вместо своего кадра она рисует
копии иконки реакции по позициям слоёв `placeholder_*` из ассета
`ReactionGeneric.json` (`reaction.ts:229-248`). Плееры генерика готовятся
ЗАРАНЕЕ, с уже отрисованным первым кадром (`prepareGenericEffect`,
`reaction.ts:620-704`; берётся — `takePreparedGenericEffect`, :686-700), поэтому
такой эффект стартует мгновенно.

У нас на промахе играет каталожный эффект «поздно» — это тоже ветка оригинала
(`reaction.ts:1512-1514`, «генерика взять негде» → `onAvailableReaction`), но
без generic'а она платит загрузкой и декодом в момент клика.

## Чем именно заблокировано

1. **Нет стикерсета generic-анимаций на бэке.** Маршрут по короткому имени есть
   (`GET /sticker-sets/{slug}` → `backend/internal/adapter/delivery/http/
   stickers_handler.go:61`, `router.go:284`; фронтовая обёртка —
   `web-client/src/core/managers/stickersManager.ts:123`
   `getSet({shortName})`), но самого набора в каталоге нет:
   `backend/assets/stickers/` содержит только `animated_emoji` и `duck`.
2. **Нет ассета `public/assets/tgs/ReactionGeneric.json`.** В tweb он лежит
   (`/Users/denisurevic/Documents/tweb/public/assets/tgs/ReactionGeneric.json`)
   и читается `loadReactionGeneric` (`reaction.ts:212-252`) — из его слоёв
   `placeholder_*` берутся позиции копий иконки. Без него `overrideRender`
   рисовать нечего. Это дозаливка файла, не блокер сам по себе.

## Что нужно на бэкенде (точно)

1. Каталог набора: `backend/assets/stickers/emoji_generic_animations/` с
   `meta.json` того же формата, что у `animated_emoji`
   (`{"title", "kind", "cover", "stickers": [{"file", "emoji", "path"}]}` —
   см. `backend/cmd/seed-stickers/main.go:33-48`) и самими `.tgs`-файлами
   generic-анимаций. Источник файлов — тот же, что у остальных наборов:
   выгрузка `tools/fetch_stickers.py` из Telegram; набор в MTProto адресуется
   конструктором `inputStickerSetEmojiGenericAnimations` (tweb
   `src/lib/appManagers/utils/stickers/constants.ts:18`), короткое имя набора
   надо снять с самой выгрузки.
2. Залить набор: `go run ./cmd/seed-stickers` (идемпотентно; slug каталога
   становится slug'ом набора, `GET /sticker-sets/emoji_generic_animations`
   после этого обязан отдавать документы).
3. Ничего больше на бэке не требуется: своего API у generic-эффекта нет,
   оригинал берёт его тем же «локальным набором по короткому имени»
   (`appStickersManager.getLocalStickerSet('inputStickerSetEmojiGenericAnimations')`).

## Что нужно на фронте после этого

1. Положить `web-client/public/assets/tgs/ReactionGeneric.json` (из tweb).
2. Портировать `loadReactionGeneric` (`reaction.ts:212-252`),
   `getGenericEffect`/`prepareGenericEffect`/`takePreparedGenericEffect`
   (`reaction.ts:605-704`), `warmUpGenericEffectAssets` (`reaction.ts:706-717`)
   и ветку `overrideRender` (`reaction.ts:1362-1436`) вместе с параметрами
   `genericEffect`/`genericEffectSize` у `wrapStickerAnimation`
   (`stickerAnimation.ts`, у нас эти опции тоже не портированы).
3. Точки прогрева генерика у оригинала: через 5 с после `user_auth`
   (`reaction.ts:719-721`) и при открытии панели реакций
   (`reactionsMenu.ts:231-233`). У нас первая точка — та же, что у
   предзагрузки каталога (`core/hooks/useAppBootstrap.ts`).
4. Заменить в `fireAroundAnimation` синхронный прогрев на промахе
   (`warmUpReactionEffect`) на полную развилку оригинала :1484-1519.

## Как ведёт себя код до закрытия долга

Промах кэша — предсказуем: эффект пытается сыграть каталожный, но ждёт не
дольше `AROUND_FIRST_FRAME_TIMEOUT` (2500 мс, порт потолка
`lottieLoader.ts:206-222`). Не успел — эффект не играет вовсе и снимает свои
узлы, гейт `chip.hasAroundAnimation` отпускается, постановка реакции при этом
не задерживается ничем (она оптимистична и от эффекта не зависит). Сами файлы
докачиваются (`warmUpReactionEffect` — порт `warmUpDownload`, :1495), поэтому
следующий клик по той же реакции играет уже нормально.

**Критерий готовности:** при полностью очищенном кэше первый же клик по
реакции даёт эффект в том же кадре (играет generic с копиями иконки), а
каталожный эффект приезжает к следующему клику.
