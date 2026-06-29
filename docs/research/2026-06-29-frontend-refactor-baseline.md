# Baseline рефакторинга фронтенда (Этап 0)

Точка отсчёта на коммите `765fe6f`, чтобы мерить прогресс «было/стало» по ходу
[плана рефакторинга](2026-06-29-frontend-refactor-plan.md). Снято 2026-06-29.

## Сборка / тесты

- `npx tsc --noEmit` — ✅ чисто (exit 0).
- `npx vitest run` — **136/137 проходят**, 1 падает.
  - ❌ `src/core/managers/mediaManager.test.ts > meta maps + caches (one GET for two calls)` —
    кэш meta не срабатывает (ожидался 1 GET, пришло 2). **Предсуществующее**, к рефактору
    не относится (файл не трогался). Чинить отдельно.

## useEffect (всего по проекту: 69)

Топ-источники:

| useEffect | Файл |
|---:|---|
| **21** | `components/ConversationView.tsx` ← главная цель |
| 5 | `App.tsx` |
| 4 | `components/Composer.tsx` |
| 3 | `components/settings/AvatarCropper.tsx` |
| 3 | `components/messages/MediaLightbox.tsx` |
| 3 | `components/StoryViewer.tsx` |
| 3 | `components/CallScreen.tsx` |
| 2 | ChatHeader, Sidebar, DiscussionView, ChatBackground, SendMediaPopup |
| 1 | useMessageWindow, usePeers, useChatSearch, useVoiceRecorder, … |

## Realtime-подписки в ConversationView

Прямые подписки на сокет (`uiEvents.on(RT.*)`) — **7 шт.**, это то, что снимает Этап 1:

| Строка | Событие |
|---:|---|
| 929 | `RT.ack` |
| 940 | `RT.messageError` |
| 948 | `RT.newMessage` |
| 969 | `RT.editMessage` |
| 974 | `RT.deleteMessage` |
| 988 | `RT.pinMessage` |
| 1088 | `RT.presence` |

(Остальные `useEvent(...)` в файле — стабилизаторы колбэков, не слушатели сокета.)

## Перф-снимок ленты (через Playwright, стек `:38443`)

Замер на демо-аккаунте `+79990000001`, чат «Команда Альфа» (программный скролл вверх/вниз ~1.5 с,
тайминги кадров через `requestAnimationFrame`):

| Метрика | Значение |
|---|---|
| DOM-нод в ленте | 136 |
| DOM-нод всего | 334 |
| высота прокрутки | 1089 px |
| средний кадр | 8.3 мс (~121 fps) |
| p95 кадр | 9.3 мс |
| «тяжёлых» кадров (>50 мс) | 0 |

> ⚠️ **Оговорка: демо-сид слишком тонкий** (десяток сообщений на чат), поэтому проблема
> *безграничного роста DOM на скролле* на нём **не воспроизводится** — отсюда «идеальные» 120 fps.
> Это **не** значит, что проблемы нет: она проявляется на чатах с сотнями сообщений, которых в сиде
> нет. Честный замер «до/после» требует **тяжёлого чата (500+ сообщений)** — либо досеять данные,
> либо снять метрику на проде. Числа выше — только для регресс-контроля (не должно стать хуже).

Харнесс воспроизводимый — тот же скрипт прогнать после Этапов 2–3 на таком же чате
(см. `browser_evaluate` со сбором `avgFrameMs`/`jankyFrames`/`feedDomNodes`).

## Цели (из плана)

- `useEffect` в `ConversationView`: **21 → единицы**.
- Прямые `uiEvents.on(RT.*)` в `ConversationView`: **7 → 0** (всё через `realtimeBridge`).
- Новое/изменённое сообщение ре-рендерит только свою строку (React Profiler).
- `tsc --noEmit` зелёный; тестов не меньше, чем сейчас (136 проходящих).
