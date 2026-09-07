# Опрос: чего у оригинала есть, а у нашего бэкенда нет

**Статус:** открыт, долги названы (не закрыты кодом).
**Дата фиксации:** 2026-09-07, ветка `feat/poll-message-content` — порт тела
опроса в ленту (`components/messages/pollMessageContent.ts`).
**Контекст:** граница порта определялась ровно этим списком: то, чего не
производит бэкенд, в разметку не заводилось — пустая кнопка или всегда
скрытая секция расходятся с оригиналом не меньше, чем их отсутствие.

## Что бэкенд УМЕЕТ (портировано)

Схема опроса у нас 1:1 с TL — `backend/internal/domain/mtpoll.go`:

| Возможность | Где на бэкенде |
|---|---|
| `messageMediaPoll` в витрине сообщения | `messagewire.go:343` → `PollInfo.ToMedia` (`mtpoll.go:180`) |
| `poll.pFlags`: `closed`, `public_voters`, `multiple_choice`, `quiz` | `mtpoll.go:205-212` |
| `pollAnswer.option` — номер варианта одним байтом | `mtpoll.go:114` `PollOption` |
| `pollResults`: `total_voters`, `results[].voters` | `mtpoll.go:201-215` |
| `pollAnswerVoters.pFlags`: `chosen` (мой выбор), `correct` (ответ викторины) | `mtpoll.go:210-213` |
| `pollResults.pFlags.min` — урезанные итоги общего кадра | `mtpoll.go:218` `MarkMin` |
| Отправка опроса | `POST /chats/{peerID}/polls` (`router.go:201`) |
| Голос и ОТЗЫВ голоса (пустой список) | `POST /polls/{pollID}/vote` (`router.go:228`, `poll.go:104`) |
| Остановка опроса (автор/админ) | `POST /polls/{pollID}/close` (`router.go:229`, `poll.go:155`) |
| Рассылка итогов участникам | кадр `poll_update` → `updateMessagePoll` (`poll.go:243`) |
| Викторина: ответ финален, `correct_option` скрыт до ответа/закрытия | `poll.go:134-147`, `poll.go:191` |

## Чего бэкенд НЕ УМЕЕТ — и что из-за этого не нарисовано

Каждая строка — своя задача; ни одна не чинится на фронте.

| № | Возможность оригинала | Чего нет на бэкенде | Что не нарисовано |
|---|---|---|---|
| 1 | Аватарки последних проголосовавших | `pollResults.recent_voters`, `pollAnswerVoters.recent_voters` — «последних проголосовавших мы не храним» (`mtpoll.go:152,175`) | `AvatarGroup` в подзаголовке и в строке варианта (tweb parts.tsx:26-51, PollOption.tsx:167-170) |
| 2 | «View Votes (N)» и таб результатов | `pollResults.pFlags.can_view_stats` не производится (`mtpoll.go:151`); ручки списка проголосовавших (`messages.getPollVotes`) нет вовсе | Ветка футера `Chat.Poll.ViewVotes` (tweb PollMessageContent.tsx:629-631) и таб `AppPollResultsTab` (`sidebarRight/tabs/pollResults.tsx`) |
| 3 | Объяснение правильного ответа викторины | `solution` / `solution_entities` / `solution_media` — «поля у опроса нет» (`mtpoll.go:153`) | Кнопка-лампа в шапке и блок `Explanation` (tweb parts.tsx:53-141) |
| 4 | Автозакрытие по таймеру | `close_period` / `close_date` — «автозакрытия по таймеру у нас нет» (`mtpoll.go:75`) | `div.timer` с `Chat.Poll.EndsIn` (tweb PollMessageContent.tsx:654-660) |
| 5 | Скрытие итогов до закрытия | `hide_results_until_close` (`mtpoll.go:75`) | Ветка `hideResults` во всех местах варианта |
| 6 | Запрет переголосования | `revoting_disabled` (`mtpoll.go:75`) | Гейт пункта «Отменить голос» (у нас он стоит без этого терма — `chat/contextMenu.ts:807-813`) |
| 7 | Перемешивание вариантов | `shuffle_answers` + `creator` (`mtpoll.go:75`) | `shuffle.ts` (порт `HashPollShuffleValue` из tdesktop) и весь пересчёт `initialIdxFromShuffledIdx` |
| 8 | Свободные ответы | `open_answers`, `pollAnswer.added_by`/`date`, ручка `messages.addPollAnswer` (`mtpoll.go:75,90`) | Компонент `AddOption` и ветки футера `Save` / `hasTypedNewOption` |
| 9 | Медиа у варианта ответа | `pollAnswer.media` (`mtpoll.go:90`) | Вся ветка `withMedia` варианта: фото/видео/стикер/гео/вебпейдж (tweb PollOption.tsx:226-299) |
| 10 | Медиа у вопроса | `messageMediaPoll.attached_media` — «предмета не имеет» (`mtpoll.go:37`) | `pollDescriptionMedia*` / `pollDocumentWrapper` (tweb PollMessageContent.tsx:447-507) |
| 11 | Разметка в вопросе и вариантах | `TextWithEntities` едет с ПУСТЫМ вектором сущностей (`mtpoll.go:80`) | Вопрос и варианты рисуются простым текстом, а не `wrapMessageText`; спойлер в вопросе — отдельный долг `poll-spoiler-overlay.md` |
| 12 | Ограничения голосования | `subscribers_only`, `countries_iso2` (`mtpoll.go:75`) | `pollVoteRestriction.ts`, тост-предупреждение, форсирование итогов |
| 13 | Хэш-кэширование опроса | `poll.hash` (`mtpoll.go:76`) | `messages.getPollResults` с `poll_hash`, перезапрос итогов по таймеру (`checkRefetchPollTimeout`) |

Клиентское, но не портированное вместе с ними:

| № | Что | Почему |
|---|---|---|
| 14 | Конфетти за верный ответ викторины (tweb parts.tsx:178-193, `hasSelectedCorrectAnswers`) | подсистемы `ConfettiContainer` у нас нет вовсе; заводить её ради одного вызова — отдельная работа |
| 15 | `data-poll-viewer-idx` и открытие медиавьювера из опроса (tweb bubbles.ts:3658-3671) | предмета нет: медиа в опросе не производится (пп. 9-10) |
| 16 | Deeplink на вариант (`highlightBubblePollAnswer`, tweb bubbles.ts:11788-11810) + `pollToOptionLink.ts` | у нас нет ни ссылок вида `?vote=`, ни пунктов меню «Copy Option Link» / «Reply to Poll Option» |
| 17 | Enter/exit-переходы `Transition name='fade-2'` вокруг процента, полоски и текста футера | классы `fade-2-*` у нас портированы (`styles/tweb/_transition.scss:169-184`), но переключателя классов для ванильного узла нет — узлы появляются и исчезают без анимации. Механика для этого в проекте есть (`core/hooks/useSetTransition`), но она React-хук; ванильного эквивалента `SetTransition` пока нет |

## Порядок

Самостоятельную ценность имеют, по убыванию: **2** (кто как проголосовал —
единственная ветка футера, которой не хватает), **3** (объяснение викторины),
**1** (аватарки), **17** (анимации переходов — чисто фронтовая, бэкенд не
нужен). Остальное — механики, которых у нас нет целиком, и начинать их надо с
бэкенда, а не с вёрстки.

**Критерий готовности каждой:** соответствующий узел появляется в
`.poll-message-content` при данных, которые его требуют, и не появляется без
них, — с пином в `components/chat/bubbles.poll.test.ts`.
