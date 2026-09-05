# Фон-паттерн шапки профиля — не портирован (нет цвета темы и эмодзи-паттерна)

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** волна 3 «Solid-миграция», программа `docs/superpowers/
plans/2026-09-05-profile-avatars-class.md`, задача 1 (каркас
`PeerProfileAvatars`), ревью задачи 6 — 2026-09-05.
**Контекст:** `components/peerProfileAvatars.ts` — вызов `applyAppearance()`
нигде не заведён (`setPeer` его не зовёт, докблок класса перечисляет это
явно). Поле `hasBackgroundColor` заведено и участвует в порогах
`updateHeaderFilled`/`need-white`, но у нас всегда равно `false`.

## Что в tweb

`_applyAppearance`/`applyAppearance` (`peerProfileAvatars.ts:652-793`, вызов
из `setPeer` :390) красит фон шапки профиля под тему пира:

1. `usePeerProfileAppearance(peerId)` (`hooks/useProfileColors.ts`) отдаёт
   `peerProfileAppearance` — производную от `profile_color` пира (Telegram
   Premium): пару hex-цветов градиента (`getHexColorFromTelegramColor`) и
   опциональный `backgroundEmojiId` (кастом-эмодзи фона, тоже часть
   `profile_color`).
2. Если `backgroundEmojiId` есть — `wrapEmojiPattern` (`components/wrappers/
   emojiPattern.ts`) рисует `canvas.profile-avatars-pattern` 393×258 с 19
   фиксированными позициями повторов эмодзи и радиальным «гало»-затемнением
   к краям; canvas накладывается на линейный градиент `bgColors`.
3. `hasBackgroundColor = !!backgroundStr` (:761) — управляет порогами
   `updateHeaderFilled`/`need-white` (:936, :952): у пира с цветной шапкой
   заголовок становится непрозрачным СРАЗУ при любом скролле (`>= 5px`), а
   без цвета — только после 200px (белый текст на фото держится дольше).

## Чего нет у нас

- Ни `profile_color` пира, ни `backgroundEmojiId` не существует НИГДЕ в
  модели: ни в TL-схеме пира (`core/models.ts`), ни на проводе
  (`GET /users/{id}`/`GET /chats/{id}` не отдают такое поле). Premium-цвета
  профиля как фичи у нас нет вовсе — это отдельная, более широкая фича
  (Telegram Premium `profile_color`/`replies_color` и т.п.), не только
  аватарная карусель.
- `wrapEmojiPattern` (`components/wrappers/emojiPattern.ts`) не портирован —
  ни canvas-рендера паттерна, ни 19 фиксированных позиций, ни «гало».
- `getHexColorFromTelegramColor` (`helpers/color.ts`) — конвертация
  Telegram-палитры (0-6 + произвольный набор) в hex — тоже отсутствует.

## Эффект сегодня

Шапка профиля везде отрисовывается БЕЗ цветного фона: `hasBackgroundColor`
всегда `false`, поэтому заголовок заливается только после явного скролла на
200px (ветка «без цвета» условия :952) — для ВСЕХ пиров, включая тех, у
кого в tweb была бы цветная шапка. Видимых артефактов (пустой `canvas`,
моргание) нет — просто ветка не вызывается вовсе, узел `.profile-
avatars-pattern` не создаётся.

## Что делать

1. Завести `profile_color`/`backgroundEmojiId` в модели пира — сначала на
   бэкенде (поле у `User`/`Chat`, где Telegram хранит `profile_color:
   PeerColor`), потом в `core/models.ts` и мапперах пиров.
2. Портировать `getHexColorFromTelegramColor` (`helpers/color.ts`) —
   таблица дефолтных Telegram-цветов + разбор кастомной палитры.
3. Портировать `wrapEmojiPattern` (`components/wrappers/emojiPattern.ts`) —
   canvas 393×258, 19 фиксированных позиций, радиальное гало; источник
   эмодзи — `backgroundEmojiId` через кастом-эмодзи пайплайн
   (`@customEmoji`).
4. `components/peerProfileAvatars.ts` — завести `applyAppearance()` (портер
   `_applyAppearance`/`applyAppearance`, tweb :652-793), звать из `setPeer`
   (:390 в оригинале), поднять `hasBackgroundColor` до реального значения.

**Критерий готовности:** профиль пира с настроенным `profile_color`
показывает градиентный фон шапки (+ эмодзи-паттерн, если задан), и
заголовок заливается на пороге 5px, а не 200px, как только шапка цветная —
тест на `peerProfileAvatars.test.ts` заводит фейковый цвет и проверяет
разные пороги `updateHeaderFilled` для `hasBackgroundColor: true/false`
(порог 200px для случая без цвета уже покрыт).
