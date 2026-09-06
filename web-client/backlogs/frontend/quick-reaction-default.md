# Быстрая реакция (`reactions_default`) — нет ни на бэке, ни на фронте

**Статус:** открыт, долг назван; ховер-реакция при этом ПОРТИРОВАНА и работает.
**Дата фиксации:** порт панели быстрых реакций, этап 3 из 3 (ветка
`feat/reactions-hover`), 2026-09-06.

## Что делает оригинал

Кнопка-пилюля над баблом (`bubble-hover-reaction`, tweb
`src/components/chat/bubbles.ts:2708-2828`) показывает ПЕРВУЮ не-платную
реакцию из `getAvailableReactionsByMessage(message, true)`
(`src/lib/appManagers/appReactionsManager.ts:398`). Второй аргумент —
`unshiftQuickReaction`: в начало списка поднимается БЫСТРАЯ реакция
пользователя (`unshiftQuickReactionInner`, :344-355), а её источник —
`config.reactions_default` (`getQuickReaction`, :437-450). Меняется она на
экране `sidebarLeft/tabs/quickReaction` и уезжает на сервер
(`messages.setDefaultReaction`).

Важная деталь: подъём происходит ТОЛЬКО когда политика пира —
`chatReactionsAll` (:268) либо это личка (:214-221). При `chatReactionsSome`
оригинал не поднимает ничего и показывает ровно первую разрешённую чатом
реакцию.

## Что у нас

Быстрой реакции нет по всей вертикали: ни поля в конфиге, ни ручки, ни
хранилища, ни `updateDefaultReaction`. Экран `web-client/src/components/
settings/QuickReaction.tsx` — пустышка: хардкод-грид эмодзи и локальный
`useState`, который никуда не сохраняется.

Поэтому `bubbles.ts::onBubblesMouseMove` показывает первую реакцию из
`getAvailableReactionsForPeer` (`web-client/src/components/chat/reactions.ts`).
Для `chatReactionsSome` это буквально поведение оригинала; для остальных —
оно же минус персонализация. Пользователя это не обманывает: на кнопке
нарисована та самая реакция, которую отправит клик по ней.

## Что делать

1. Бэк: поле «быстрая реакция» у пользователя + ручка чтения/записи (аналог
   `config.reactions_default` и `messages.setDefaultReaction`); отдавать её
   вместе с конфигом клиента.
2. Фронт: порт `getQuickReaction` + `unshiftQuickReactionInner` в
   `chat/reactions.ts` (флаг `unshiftQuickReaction` у
   `getAvailableReactionsForPeer`, как у оригинала), передача `true` из
   ховер-реакции и панели.
3. `QuickReaction.tsx` — подключить к этой же ручке вместо локального стейта,
   каталог брать из `GET /reactions`, а не из хардкода.

**Критерий готовности:** выбранная на экране настроек реакция сохраняется,
переживает перезагрузку и именно она нарисована на кнопке над баблом в личке и
в чате с политикой `chatReactionsAll`.
