# Интерактивный кроппер аватара — нет Solid-порта

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** волна 3 «Solid-миграция» (задача 6, снос React-версии экрана
входа), ревью — 2026-09-04.
**Контекст:** экран регистрации (`SignUpCard.solid.tsx`, карточка `signUp`)
даёт выбрать аватар до сабмита. Ресайз/JPEG-конвертация/`width`/`height` уже
закрыты (задача 6, `core/media/scaleImageForSend.ts`) — этот долг **только**
про интерактивный кроп: пан/зум/поворот перед загрузкой.

## Почему не закрыто вместе со сносом React-версии

У снесённой React-карточки (`components/auth/cards/SignUpCard.tsx`, задача 6
её удалила) кроп делал `components/settings/AvatarCropper.tsx` — React-хуки,
drag-to-pan + zoom, свой собственный (не 1:1 с tweb) компонент. У tweb на этом
месте вообще другое устройство — целый `PopupAvatar` (кадрирование/зум/поворот,
vanilla DOM, framework-agnostic попап, `src/components/popups/avatar.ts`), наша
React-версия его тоже не портировала дословно.

`AvatarCropper.tsx` **нельзя снести** вместе с React-картой входа: он живой и
нужен другим React-экранам, ещё не переехавшим на Solid — `EditProfile.tsx`,
`NewGroupFlow.tsx`, `EditContactView.tsx`, `GroupEditFlow.tsx`. Подключить его
из Solid-карточки тоже нельзя: граница рантаймов держится `shared/solid/
boundary.test.ts` (`*.solid.tsx` не имеет права импортировать `react`), а
обратного моста «React-компонент внутри Solid-острова» в проекте не заведено
— есть только `<SolidIsland>` (Solid внутри React), не наоборот. Заводить
такой мост ради ОДНОЙ карточки было бы архитектурной отсебятиной сверх
периметра задачи (§ 6 `docs/superpowers/specs/2026-08-28-solid-migration-
design.md` — мост держится строго в одну сторону).

## Что делать

Портировать интерактивный кроп на Solid — по объёму ближе к дословному порту
tweb `popups/avatar.ts` (`PopupAvatar`), чем к повторению нашего React
`AvatarCropper.tsx`: программа явно требует источником поведения tweb, а не
собственную React-версию (`docs/superpowers/specs/2026-08-28-solid-migration-
design.md § 6a`). Разобрать на месте, какая часть API `PopupAvatar` (крутилка
поворота, зум-слайдер, маска круга/фото профиля) реально нужна на карточке
регистрации — там только выбор файла до сессии, полноценный попап настроек
профиля не открывается.

**Затрагиваемые файлы:**
- `web-client/src/components/auth/cards/SignUpCard.solid.tsx` (`sendAvatar`/
  `onFileChosen`/`pickedFile` — сюда встраивается интерактивный кроп);
- новый `web-client/src/components/auth/AvatarCropper.solid.tsx` (или общий
  `shared/`, если кроп потребуется другим Solid-экранам раньше, чем они сами
  доедут волной миграции) — источник `tweb/src/components/popups/avatar.ts`.

**Критерий готовности:** выбор файла на карточке регистрации открывает
интерактивный кроп (пан/зум минимум), подтверждённый кадр уходит в
`scaleImageForSend` → `media.upload` с `width`/`height`, соответствующими
РЕАЛЬНО кадрированной области, а не исходному файлу целиком.
