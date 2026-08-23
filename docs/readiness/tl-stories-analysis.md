# Истории: разбор перед портом

Восьмая — и последняя названная — подсистема программы TL (`tl-program.md`).
Порядок разбора тот же, что у медиа, сущностей, разметки, пиров, диалогов,
сообщения, стикеров и кадров: сначала таблица расхождений, потом решения, потом
бэкенд → фронт → тесты → мутации.

Истории оказались подсистемой, где собраны **все** болезни, которые прошлые
порты лечили поодиночке: медиа ссылкой вместо ступени, вид сущности строкой,
пер-зрительский факт признаком на каждом элементе, карточка автора внутри
группы, удаление отдельным кадром. Ни одна из них здесь не новая — новое только
то, что они встретились в одном объекте.

## Таблица расхождений

`storyItem#16a4b93c` схемы против нашей `domain.StoryItem` + `storyJSON`:

| наше поле (провод) | что в схеме | разряд расхождения |
|---|---|---|
| `media_id` | `media: MessageMedia` (обязательный) | медиа ССЫЛКОЙ вместо ступени |
| `viewed` | `peerStories.max_read_id` | пер-зрительский признак вместо ГОРИЗОНТА |
| `privacy: "everyone"\|"contacts"\|"close"\|"selected"` | флаги `public`/`contacts`/`close_friends`/`selected_contacts` + `privacy: flags.2?Vector<PrivacyRule>` | вид подделан строкой |
| `allow_user_ids` | `privacyValueAllowUsers.users` внутри того же `privacy` | своя форма того же предмета |
| `created_at`, `expires_at` — ISO-строки | `date:int`, `expire_date:int` — секунды | единицы |
| `reactions_count`, `my_reaction`, `reactions[]` | `views: flags.3?StoryViews` (внутри `reactions`, `reactions_count`) + `sent_reaction: flags.15?Reaction` | агрегат размазан тремя полями |
| `reactions[].mine` | `reactionCount.chosen_order: flags.0?int` | форма, УЖЕ портированная у сообщения |
| `pinned`, `edited` | `pinned: flags.5?true`, `edited: flags.11?true` | верхний уровень вместо `pFlags` |
| `caption` — всегда есть | `caption: flags.0?string` + `entities: flags.1?Vector<MessageEntity>` | подпись без разметки |
| `media_areas[].type` | семь конструкторов `MediaArea` | вид подделан строкой |
| `fwd_from: {author_id, story_id}` | `storyFwdHeader{from:Peer, from_name, story_id, modified}` | автор числом вместо `Peer` |
| — | `from_id: flags.18?Peer` | предмет есть (автор группы), но в самой истории не едет |
| — | `out: flags.16?true`, `min: flags.9?true`, `noforwards: flags.10?true` | флаги без предмета |
| — | `albums`, `music` | предмета нет |

Контейнеры:

| наша ручка | ответ у нас | конструктор схемы |
|---|---|---|
| `GET /stories` | `{groups:[{author:User, stories:[…]}]}` | `stories.allStories{count, state, peer_stories:Vector<PeerStories>, chats, users, stealth_mode, has_more}` |
| — | — | `peerStories{peer, max_read_id, stories}` |
| `GET /stories/archive`, `/stories/pinned` | `{stories:[…]}` | `stories.stories{count, stories, pinned_to_top, chats, users}` |
| `GET /stories/{id}/viewers` | `{viewers:[User], count}` | `stories.storyViewsList{count, views_count, forwards_count, reactions_count, views:Vector<StoryView>, chats, users, next_offset}` |
| `GET /stories/stealth` | `{active_until, cooldown_until}` — ISO/`null` | `storiesStealthMode{active_until_date:flags.0?int, cooldown_until_date:flags.1?int}` |
| `GET /stories/{id}/stats` | `{views, views_by_day, reactions_total, reactions}` | `stats.storyStats{views_graph:StatsGraph, reactions_by_emotion_graph:StatsGraph}` |

Кадры:

| наш кадр | payload | конструктор схемы |
|---|---|---|
| `story_new` | `{id, author_id, media_id, caption, expires_at}` | `updateStory{peer, story:StoryItem}` |
| `story_deleted` | `{story_id, author_id}` | **тот же** `updateStory`, но с `storyItemDeleted` внутри |
| `story_reaction` | `{story_id, user_id, reaction, reactions_count}` | `updateSentStoryReaction{peer, story_id, reaction}` |
| — | — | `updateReadStories{peer, max_id}` |
| — | — | `updateStoriesStealthMode{stealth_mode}` |

## Главное: у истории нет медиа — есть номер файла

`media_id` — единственная связь истории с содержимым, и она ссылка. В схеме
`storyItem.media` это **обязательный** `MessageMedia`: та же ступень
`messageMediaPhoto`/`messageMediaDocument` → `photo`/`document` → `sizes`/
`attributes`, которую порт медиа уже построил для вложения сообщения и которой
уже пользуется витрина сообщений (`BuildDocument`).

Следствие видно на клиенте: `StoryItem.mediaId: number`, и всё, что вьюверу
нужно знать о файле — размеры, тип, превью, длительность видео, — он не знает
вовсе. Ровно тот же пробел, что был у стикеров: ступень построена, но к этой
подсистеме не подключена.

## «Просмотрено» — признак на каждой истории вместо горизонта

`storyJSON.viewed` — пер-зрительское поле НА КАЖДОЙ истории, считаемое запросом
в `story_views`. В схеме прочитанность историй выражена **горизонтом**:
`peerStories.max_read_id`, один номер на автора, и кадр `updateReadStories{peer,
max_id}` двигает его. Это тот же механизм, что у диалога
(`read_inbox_max_id`), и та же экономия: один номер вместо признака на элемент.

**Горизонт у нас не выражается**, и причина не в форме ответа, а в адресации:
`stories.id` — глобальный `BIGSERIAL` (миграция `0009_stories.sql`), а горизонт
имеет смысл только при **пер-авторской** нумерации. Это тот же долг, что был у
сообщения (`messages.id` против `seq`) и у чата (суррогатный ключ против ключа
пира), и закрывается он тем же ходом — нумерацией внутри автора.

Таблица `story_views` при этом никуда не девается: она отвечает на ДРУГОЙ
вопрос — «кто посмотрел» (`stories.getStoryViewsList`), и он у оригинала тоже
есть. Уходит только вывод «прочитал ли ЗРИТЕЛЬ» из этой таблицы на каждый
элемент ленты.

## Приватность — строка вместо флагов и правил

`privacy: "everyone"|"contacts"|"close"|"selected"` — вид, подделанный
значением поля: та же болезнь, что лечили порты сообщения, чата и стикеров, и
второй её экземпляр внутри самой этой подсистемы (первый — `mediaArea.type`).
В схеме это ЧЕТЫРЕ флага истории (`public`, `contacts`,
`close_friends`, `selected_contacts`) плюс отдельный параметр `privacy:
Vector<PrivacyRule>` с полным набором правил (`privacyValueAllowContacts`,
`privacyValueAllowCloseFriends`, `privacyValueAllowUsers`, …).

Наш `allow_user_ids` — это и есть `privacyValueAllowUsers.users`, выложенный
рядом отдельным ключом. Причём у нас он отдаётся ТОЛЬКО автору — и это совпадает
с оригиналом: `privacy` в `storyItem` едет автору собственной истории, чужому
зрителю аудитория не раскрывается. То есть правило уже соблюдается, просто
записано своей формой.

## Реакции: две формы одного факта уже сосуществуют

Порт сообщения перевёл реакции на `messageReactions`/`reactionCount`
(`domain.mtmessage.go`), где «моя реакция» — это `chosen_order`. Истории при
этом остались на `domain.ReactionCount{Emoji, Count, Mine, Recent}` и кладут его
на провод как есть (`reactionsJSON`). Две формы одного предмета на одном
проводе — ровно то, ради устранения чего программа существует; просто они
разъехались не между сторонами, а между подсистемами.

Сверх того агрегат размазан по трём ключам верхнего уровня
(`reactions_count`/`my_reaction`/`reactions`), тогда как в схеме два из них
лежат ВНУТРИ `storyViews`, а третий — `sent_reaction` — отдельным параметром
истории, потому что он единственный пер-зрительский.

## Область поверх истории — один тип с семью необязательными половинами

`domain.StoryMediaArea` — одна структура с полем `type` и восемью
необязательными полями, из которых заполняется своя половина. В схеме это
семь РАЗНЫХ конструкторов одного объединения:

| наш `type` | конструктор | что требует сверх наших полей |
|---|---|---|
| `geo` | `mediaAreaGeoPoint{coordinates, geo:GeoPoint, address}` | `geo` — ступень `geoPoint`, а не пара `lat`/`long` |
| `venue` | `mediaAreaVenue{coordinates, geo, title, address, provider, venue_id, venue_type}` | `provider`/`venue_id`/`venue_type` — предмета нет |
| `reaction` | `mediaAreaSuggestedReaction{dark, flipped, coordinates, reaction:Reaction}` | `reaction` — объединение, а не строка эмодзи |
| `url` | `mediaAreaUrl{coordinates, url}` | — |
| — | `mediaAreaChannelPost`, `mediaAreaWeather`, `mediaAreaStarGift` | предмета нет |

`mediaAreaCoordinates` совпадает почти буквально — расходится один параметр:
`radius: flags.0?double` (круглая область), которого мы не производим.

Клиентская `MediaArea` — зеркало нашей же серверной структуры, включая
`type`-строку; ветвление по ней идёт в двух местах вьювера.

## Контейнер ленты: карточка автора внутри группы

`{groups:[{author, stories}]}` — карточка пользователя лежит ВНУТРИ группы.
Порт диалогов эту болезнь уже лечил (решение Р1 `tl-dialogs-analysis.md`):
объекты едут ОДИН раз векторами `users`/`chats`, а внутри стоят ссылки. Здесь
то же самое: `stories.allStories{peer_stories, chats, users}`, а группа —
`peerStories{peer, max_read_id, stories}`, где автор это `Peer`.

Дополнительно в контейнере оригинала едут `state` (курсор ленты историй) и
`stealth_mode` — то есть stealth-окно приезжает ВМЕСТЕ с лентой, а не отдельной
ручкой `GET /stories/stealth`.

## Просмотры теряют дату и реакцию

`GET /stories/{id}/viewers` отдаёт `{viewers: [User], count}` — голые карточки.
`storyView` схемы несёт `date` (когда посмотрел) и `reaction` (чем отреагировал),
плюс флаги `blocked`/`blocked_my_stories_from`, а сам `StoryView` — объединение
из трёх конструкторов (обычный просмотр, публичная пересылка, публичный репост).
Предмет «когда посмотрел» у нас ЕСТЬ — колонка `story_views.viewed_at`, — и на
провод не выходит.

## Статистика — расхождение с самой схемой, а не с кодом

`stats.storyStats` состоит из двух `StatsGraph`, то есть из `DataJSON` для
графической библиотеки. У нас — свой ряд `views_by_day: [{date, value}]` плюс
суммарные реакции. Это тот же класс, что тема чата и признак секретного чата:
предмет есть, но другой природы. Место такому — `port-divergences.md`, а не
подгонка формы под `StatsGraph`, которого нечем наполнить.

## Наши собственные поля

Через `schema_additional_params.json` придётся объявить ровно один параметр —
и то лишь если решение Р3 (горизонт) будет отложено:

- `storyItem.viewed` — пер-зрительский признак прочтения. Объявляется ЯВНО, с
  комментарием, что это временная форма горизонта `peerStories.max_read_id`.

Всё остальное из нашего провода в схеме место имеет.

## Чего в схеме есть, а у нас предмета нет

Названо, а не забыто (правило разборов):

- `storyItemSkipped` — «история есть, тела не дали». У нас лента всегда отдаёт
  тело целиком, состояния «знаю про историю, но не показываю» нет;
- `albums` / `music` / `stories.albums*` / `stories.startLive` — подсистем нет;
- `min`, `noforwards`, `out` — предмета нет ни на одной стороне;
- `storyViews.has_viewers`, `forwards_count`, `recent_viewers` — счётчика
  пересылок у историй нет вовсе (`storyrepo.go:244` это фиксирует), последних
  зрителей мы не отдаём;
- `stories.stories.pinned_to_top`, `stories.allStories.state`/`has_more` —
  курсора и «закреплено наверху» у ленты нет;
- `storyFwdHeader.from_name` (репост от скрытого автора) и `modified`;
- `StoryView` варианты `storyViewPublicForward`/`storyViewPublicRepost` —
  публичных пересылок нет;
- `StoryReaction*` (`stories.getStoryReactionsList`) — списка «кто чем
  отреагировал» у нас нет, есть только агрегат;
- `updateStoryID` — у историй нет оптимистичной отправки с `random_id`.

## Решения

**Р1. История становится `storyItem`, медиа — `MessageMedia`.** `media_id`
уходит с провода; ступень строит тот же билдер, что и вложение сообщения. Это
самая большая по объёму часть порта и одновременно самая механическая: ступень
уже есть, подключить её к другому источнику.

**Р2. Объединение `StoryItem` заводится целиком — двумя конструкторами.**
`storyItem` и `storyItemDeleted`. `storyItemSkipped` не производится (предмета
нет, назван выше). Удалённая история перестаёт быть отдельным КАДРОМ и
становится выбором конструктора внутри `updateStory` — см. Р9.

**Р3. «Прочитано» становится горизонтом `peerStories.max_read_id`, и это
требует пер-авторской нумерации историй.** Признак `viewed` на каждой истории
уходит. Цена названа честно: `stories.id` глобальный, нужна миграция —
пер-авторский номер, как `seq` у сообщения. Пока миграции нет, `viewed`
остаётся ОБЪЯВЛЕННЫМ клиентским параметром (`schema_additional_params.json`) с
комментарием, что это временная форма горизонта; молчаливым пропуском он не
остаётся ни на день.

**Р4. Приватность — флаги истории плюс `privacy: Vector<PrivacyRule>`.** Строка
`privacy` и ключ `allow_user_ids` уходят оба: `everyone` → `pFlags.public`,
`contacts` → `pFlags.contacts`, `close` → `pFlags.close_friends`, `selected` →
`pFlags.selected_contacts` + `privacyValueAllowUsers{users}`. Правило «аудиторию
видит только автор» не меняется — оно уже соблюдается.

**Р5. Реакции истории — `views: StoryViews` + `sent_reaction: Reaction`.**
Тройка `reactions_count`/`my_reaction`/`reactions` схлопывается; разбивка
переходит на тот же `reactionCount` с `chosen_order`, что уже используется
сообщением. Вторая форма `domain.ReactionCount` на проводе исчезает — внутри
репозиториев она остаётся как есть, это не проводная структура.

**Р6. `MediaArea` — объединение конструкторов.** Строка `type` уходит; `lat`/
`long` становятся ступенью `geoPoint`; эмодзи предложенной реакции становится
`Reaction`. `mediaAreaVenue` производим БЕЗ `provider`/`venue_id`/`venue_type` —
предмета нет, и это тот случай, когда обязательный параметр пишется заглушкой на
проводе TL (`domain.OmittedWithoutSubject`), а не выдумывается.

**Р7. `fwd_from` — `storyFwdHeader`.** `author_id: int64` становится
`from: Peer`, как везде после порта пиров.

**Р8. Контейнеры — `stories.allStories` и `stories.stories`.** Карточки авторов
уезжают в векторы `users`/`chats`, группа становится `peerStories`. Ручки
архива и закреплённых отвечают `stories.stories`. Ручка `GET /stories/stealth`
остаётся (у оригинала stealth едет внутри контейнера ленты, но у нас есть и
активация отдельным вызовом — `stories.activateStealthMode` тоже отдельный
метод).

**Р9. Кадры историй — три конструктора вместо трёх собственных типов.**
`story_new` и `story_deleted` схлопываются в `updateStory{peer, story}` (второй
— с `storyItemDeleted`), `story_reaction` → `updateSentStoryReaction{peer,
story_id, reaction}`. Появляется `updateReadStories{peer, max_id}` — раньше
прочтение не рассылалось вовсе, и вторая вкладка о нём не узнавала. Это закрывает
«истории» из задачи #52.

**Р10. Даты — секунды эпохи.** `created_at`/`expires_at`/`viewed_at`/stealth-окно
перестают быть ISO-строками, как это уже сделано у сообщения и черновика.

**Р11. Подпись получает `entities`.** У истории в схеме подпись размечена тем
же `Vector<MessageEntity>`, что и текст сообщения. У нас разметки нет вовсе —
предмет появляется вместе с параметром, потому что колонка сущностей уже есть
у соседних таблиц (миграция `0100`), а редактор подписи — общий с композером.

**Р12. Статистика историй — объявленное расхождение со схемой.** `StatsGraph`
мы не производим; наш ряд по дням остаётся своей формой и записывается в
`port-divergences.md` рядом с темой чата.

## Замороженные кадры: миграция нужна

Кадры историй логируются в `updates.payload` (журнал апдейтов). Как и у
`0100`/`0101`/`0107`/`0111`–`0124`, постоянный переходник на чтении и есть тот
второй источник истины, ради устранения которого всё делается, — поэтому строки
переписываются миграцией. Следующий свободный номер — `0125`.

## Границы

Порт истории — это форма объекта и провода. НЕ входят:

- вьювер историй как таковой (вёрстка, жесты, таймлайн) — он и так наш;
- альбомы, live-истории, публичные репосты, поиск по историям — подсистем нет;
- графики статистики (`StatsGraph`) — расхождение, а не пробел (Р12).

## Исполнено: шаги A–C

Шаг **A** (модель) и шаги **B**/**C** (витрины и клиент) сделаны. Что оказалось
не так, как предполагал разбор:

- **Плоская запись области жила в ТРЁХ местах, а не в двух.** Разбор называл
  вход и витрину; на деле та же форма лежала ещё и в колонке
  `stories.media_areas`. Поэтому области переписаны миграцией `0125` и стали
  объединением на всём пути — тело запроса, jsonb, ответ.
- **`MediaDims` оказался близнецом `domain.MediaSource`.** Пятнадцать тех же
  полей под другим именем, заполнявшихся переписыванием поле-в-поле. Порт
  историй упёрся в него первым же шагом (истории тоже нужны метаданные файла) —
  тип теперь один, и `MediaID`/`Spoiler`/`Kind` дописывает тот, кто знает МЕСТО
  файла: сообщение из своей строки, история из mime.
- **Вид медиа истории пришлось выводить.** Столбца `type` у истории нет, и
  разбор этого не заметил. Вывод идёт из mime — ровно тот, который УЖЕ делал
  клиент (`useStoryPreviewMedia`: `mime.startsWith('video/')`), только теперь
  один раз на сервере.
- **Кадр `story_new` построить историю не может.** Он несёт плоские поля, а у
  `storyItem` обязательна ступень медиа. До шага D витрина перечитывает ленту
  целиком — иначе в зеркало попала бы история с `media: null`, то есть вторая,
  урезанная форма того же предмета.

## Шаги

Тот же рецепт, что у прошлых семи подсистем:

- **A. Модель.** `domain/mtstory.go` — `StoryItem`/`StoryViews`/`StoryFwdHeader`/
  `MediaArea`/`PeerStories` + сверка со схемой `mtstory_schema_test.go`
  (зеркало `mtmedia_schema_test.go`).
- **B. Витрины и журнал.** `story_handler.go` переводится на конструкторы,
  контейнеры собираются с векторами `users`/`chats`; замороженные кадры —
  миграция `0125`, конвертация проверяется на живом Postgres.
- **C. Клиент.** `mapStory` исчезает (форма провода = форма модели),
  `storiesStore` ветвится по конструктору, медиа истории идёт через тот же
  конвейер, что медиа сообщения.
- **D. Кадры.** `updateStory`/`updateReadStories`/`updateSentStoryReaction` в
  `mtupdate.go` и `updateCatalog.ts`; три собственных типа кадров уходят.
- **E. Горизонт.** Пер-авторская нумерация историй и `max_read_id` — отдельным
  шагом, потому что это миграция данных, а не формы (Р3).
