# Обезьянка на шаге кода (TrackingMonkey) — фича tweb потеряна насовсем

**Статус:** открыт, фича УТРАЧЕНА (не просто отложена — снесён единственный
рабочий порт).
**Дата фиксации:** волна 3 «Solid-миграция» (задача 6, снос React-версии
экрана входа), ревью — 2026-09-04.

## Что это

tweb `src/components/monkeys/tracking.ts` — lottie-анимация на карточке ввода
кода подтверждения: две canvas-анимации (idle-луп + tracking, кадр по проценту
набранного) в одном `div.media-sticker-wrapper`, `focus`/`blur`/`input`
переключают луп/кадр. Разбор устройства — докблок
`components/auth/cards/AuthCodeCard.solid.tsx` (заголовок «Обезьянка»).

## Как дошли до потери

Волна 3, задача 4 (Solid-порт `SignInCard`/`AuthCodeCard`/`PasswordCard`) уже
выносила обезьянку за периметр — тогда у нас ещё БЫЛ рабочий React-порт
(`components/TrackingMonkey.tsx`), и `AuthCodeCard.solid.tsx` рисовала
статическую заглушку (`div.media-sticker-wrapper` без канв) с явным долгом
«Solid-версии нет, React жив». Задача 6 снесла React-версию экрана входа
целиком, и `TrackingMonkey.tsx` следом — у него не осталось НИ ОДНОГО
потребителя нигде в репозитории (единственным была уже снесённая
React-карточка). Итог: не «Solid ещё не готов, но есть откуда портировать»,
а «портировать неоткуда в этом дереве — нужен НОВЫЙ порт с нуля из tweb».

## Что делать

Solid-порт `monkeys/tracking.ts` с нуля (источник — tweb, не наш снесённый
React-компонент, который уже в истории git на момент, когда он ещё
существовал, — см. `docs/superpowers/specs/2026-08-28-solid-migration-design.
md § 6a`, «источник порта — компонент tweb, а НЕ наш React»): две
lottie-канвы (`TwoFactorSetupMonkeyIdle`/`TwoFactorSetupMonkeyTracking`, порт
`components/lottie.ts::loadLottie`, уже используется другими Solid-картами —
`MediaHeader.solid.tsx`), `focus`/`blur` → `playAnimation(0|1)`,
`input` → `playAnimation((1 + typed) / length * 45)`, подыгрывание кадра
(`setDirection` + пауза на `enterFrame`), возврат к 0 на speed 7.

**Затрагиваемые файлы:**
- новый `web-client/src/components/auth/TrackingMonkey.solid.tsx`;
- `web-client/src/components/auth/CodeInput.solid.tsx` — проп `onFocusChange`
  снят задачей 4 («потребителя пропа нет»), возвращается вместе с этим портом;
- `web-client/src/components/auth/cards/AuthCodeCard.solid.tsx` — заглушка
  `div.media-sticker-wrapper` заменяется настоящим компонентом.

**Критерий готовности:** карточка ввода кода показывает живую анимацию
обезьянки, которая закрывает глаза при фокусе на инпуте и «отслеживает» набор
цифр — 1:1 с tweb `monkeys/tracking.ts` по кадрам/таймингам, разобранным в её
докблоке.
