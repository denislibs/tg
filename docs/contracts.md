# Messenger API — Contracts (Phase 0)

Full request/response contract for every endpoint and WebSocket frame. The
machine-readable source of truth is the OpenAPI spec:

- **OpenAPI YAML:** `backend/internal/openapi/openapi.yaml` (embedded in the binary)
- **Served at runtime:** `GET /openapi.yaml` (raw spec) and `GET /swagger` (Swagger UI)

> Behind nginx the REST API is mounted under `/api/` (e.g. `POST /api/auth/sign_in`).
> Paths below are written without the prefix.

## Conventions

- All bodies are JSON. All timestamps are RFC 3339 (`created_at`) unless noted as
  epoch milliseconds (`date`, `last_seen`).
- **Auth:** protected endpoints require `Authorization: Bearer <token>`, where
  `<token>` is the device session token from `/auth/sign_in`. Missing/invalid →
  `401 {"_": "error", "code": 401, "text": "..."}`.
- **Ошибки** — конструктор `error{code, text}` схемы. В оригинале ошибка не
  витрина метода, а ЗАМЕНА результата в транспорте (`rpc_error`, секция
  MTProto); у нас эту позицию занимает статус HTTP, а `code` дублирует его,
  потому что по проводу DNP строки статуса нет вовсе. Где ответ несёт ожидание,
  остаток секунд едет ВНУТРИ текста (`RESEND_TOO_SOON_<N>`,
  `2FA_CONFIRM_WAIT_<N>`) — форма оригинала (`FLOOD_WAIT_<N>`), потому что у
  конструктора параметров ровно два.
- **«Получилось»** — конструктор `Bool` (`boolTrue`/`boolFalse`), а не ключ
  `ok`. Так отвечают 212 из 790 методов оригинала.
- **Список сообщений** — контейнер `messages.Messages`: `messages.messages`
  («отдано ВСЁ», параметра `count` нет — он и есть длина вектора) либо
  `messages.messagesSlice` («отдан кусок», `count` — размер полного набора).
  Признаков «дошли до верха/низа» у контейнера нет: их выводит КЛИЕНТ из
  полноты окна (порт `appMessagesManager.ts:9512-9518`). Карточки авторов едут
  рядом, вектором `users`.
- `seq` — monotonic per-chat message sequence. `pts` — per-user update cursor
  (each update carries `pts` and `pts_count`; the client tracks the latest `pts`).
- IDs are int64.

### Форма объектов — конструкторы схемы TL

Предметные структуры один в один с оригиналом (`schema/schema.json`), и правила
у них общие для ВСЕГО провода — REST и WS одинаково:

- у объекта есть дискриминатор `_` со значением predicate схемы
  (`message`, `user`, `peerUser`, `messageMediaPhoto`, `updateNewMessage`, …);
- **вид сущности выражает ВЫБОР конструктора**, а не значение поля: служебное
  сообщение это `messageService`, а не `type: "service"`; «черновик снят» —
  `draftMessageEmpty`, а не `null`;
- поля `flags` в объекте НЕТ (маска существует только на бинарном проводе);
  булевы флаги собраны в под-объект `pFlags` и всегда несут `true` —
  **«выключено» значит ОТСУТСТВИЕ ключа**, не `false` и не `null`;
- остальные необязательные поля — на верхнем уровне, «нет значения» = ключа нет;
- `bytes` схемы на JSON-проводе едут base64-строкой (`photoStrippedSize.bytes`,
  `keyboardButtonCallback.data`) — на проводе TL это настоящие байты;
- наши собственные поля объявлены штатным механизмом оригинала
  (`schema/schema_additional_params.json`), а не дописаны рядом.

Разбор и обоснования — `docs/readiness/tl-program.md`. WS умеет отдавать кадры
и бинарным TL (подпротокол `tl.1`, см. раздел WebSocket); REST пока только JSON.

---

## Auth & sessions

### POST /auth/request_code  · public
Request a login code. In dev the code is **not** sent — it is logged server-side
(`DEV_OTP_CODE`, default `12345`).
- Request: `{ "phone": "+79990000000" }`
- 200: `{ "_": "boolTrue" }`
- 400: `{ "_": "error", "code": 400, "text": "phone is required" }`

### POST /auth/sign_in  · public
Проверяет код и отвечает ИСХОДОМ шага — конструктором объединения
`auth.Authorization`. Ветку называет `_`, а не наличие ключей рядом.
- Request: `{ "phone": "+79990000000", "code": "12345", "device": "web", "platform": "browser" }`
  (`device`, `platform` optional)
- 200 сессия выдана: `{ "_": "auth.authorization", "token": "<opaque>", "user": { "_": "user", "id": 1, … } }`
  — карточка КРАТКАЯ: полной формы (`bio`, день рождения) вход не отдаёт, её
  приносит первый же `GET /me`
- 200 нужна регистрация: `{ "_": "auth.authorizationSignUpRequired", "signup_token": "<opaque>" }`
- 200 включён облачный пароль: `{ "_": "auth.passwordNeeded", "password_token": "<opaque>", "hint": "…" }`
- 401: `{ "_": "error", "code": 401, "text": "invalid code" }`

`token` и `signup_token` — наши параметры, объявленные клиентскими у
конструкторов схемы; `auth.passwordNeeded` — наш конструктор целиком (у
оригинала это ошибка `SESSION_PASSWORD_NEEDED` плюс состояние сессии MTProto,
которого у REST нет).

Тем же исходом отвечают `POST /auth/sign_up`, `POST /auth/sign_import`,
`POST /auth/check_password`, `POST /auth/password/recover/confirm` и
`POST /auth/passkey/finish`.

### POST /auth/qr/new  · public
Заводит эфемерную запись входа по коду (Redis, ~60s TTL) и отдаёт сам код.
Ссылки для сканера в ответе НЕТ: её строит клиент от своего origin (серверная
выводилась из заголовков прокси и теряла порт — адрес ехал дважды).
- Request: `{ "platform": "web" }` (`platform` optional)
- 200: `{ "_": "auth.loginToken", "expires": 1787334148, "token": "<base64>" }`
  — `token` в схеме БАЙТЫ; маршрут `/auth/qr/{token}` берёт ту же величину
  шестнадцатеричной записью
- 503: `{ "_": "error", "code": 503, "text": "qr login unavailable" }` (no QRStore / Redis down)

### GET /auth/qr/{token}  · public
Опрос записи. Подтверждённая запись одноразовая — читается один раз.
- 200 ждёт подтверждения: `{ "_": "auth.loginToken", "expires": 1787334148, "token": "<base64>" }`
- 200 подтверждено: `{ "_": "auth.loginTokenSuccess", "authorization": { "_": "auth.authorization", "token": "<opaque>", "user": { "_": "user", … } } }`
  — ТОТ ЖЕ исход входа, что у обычного шага
- 404: `{ "_": "error", "code": 404, "text": "AUTH_TOKEN_EXPIRED" }` — код протух,
  уже прочитан либо неизвестен. Это ОТКАЗ, а не третий конструктор объединения
  (форма оригинала); прежде тут ехало `{"status":"expired"}` со статусом 200
- 503: `{ "_": "error", "code": 503, "text": "qr login unavailable" }`

### POST /auth/qr/confirm  · auth
Called by an already-authenticated device (the scanner) to approve a pending QR
login. Mints a fresh session for the caller and attaches it to the record.
- Request: `{ "token": "<opaque>" }`
- 200: `{ "_": "boolTrue" }`
- 400: `{ "_": "error", "code": 400, "text": "token is required" }`
- 404: `{ "_": "error", "code": 404, "text": "invalid or expired token" }` (unknown/expired/already used)
- 503: `{ "_": "error", "code": 503, "text": "qr login unavailable" }`

### GET /me  · auth
- 200 — та же ПАРА, что и `GET /users/{id}`: конструктор
  `users.userFull{full_user, chats, users}` В КОРНЕ, без обёртки. `can_message`
  лежит ВНУТРИ него — это наш клиентский параметр
  (`schema_additional_params.json`), схемного места у него нет. Третьей формы
  «своей карточки» больше не существует:
```json
{ "_": "users.userFull",
  "full_user": { "_": "userFull", "id": 1, "about": "" },
  "users": [ { "_": "user", "id": 1, "phone": "+79990000000",
               "first_name": "…", "pFlags": { "self": true } } ],
  "chats": [],
  "can_message": true }
```
- 401: `{ "_": "error", "code": 401, "text": "missing token" | "invalid token" }`

### GET /sessions  · auth
Список устройств владельца — контейнер `account.authorizations`. «Текущая» это
ФЛАГ: его ОТСУТСТВИЕ и есть «не текущая». Адрес сессии зовётся `hash` (имя
схемы), даты — в секундах эпохи.
- 200:
```json
{ "_": "account.authorizations", "authorization_ttl_days": 0,
  "authorizations": [ { "_": "authorization", "pFlags": { "current": true },
                        "hash": 3, "device_model": "web", "platform": "browser",
                        "date_created": 1787334148, "date_active": 1787334148,
                        "ip": "1.2.3.4", "country": "Москва" } ] }
```

### DELETE /sessions/{deviceID}  · auth
Revoke a session (deletes the device, evicts its cache, **closes its live WS socket**).
- 200: `{ "_": "boolTrue" }`
- 404: `{ "_": "error", "code": 404, "text": "session not found" }`

### POST /auth/logout  · auth
Revoke the current session (same effect as revoking the caller's own device).
- 200: `{ "_": "boolTrue" }`

---

## Chats

### POST /chats  · auth
Create (or return the existing) private chat with another user.
- Request: `{ "user_id": 2 }`
- 200: `{ "chat_id": 1 }`

### GET /chats  · auth
List the user's dialogs, newest activity first.
- 200 — КОНТЕЙНЕР `messages.dialogs` (или `messages.dialogsSlice`, когда список
  не влез целиком):
```json
{ "_": "messages.dialogs",
  "dialogs":  [ { "_": "dialog", "peer": { "_": "peerUser", "user_id": 2 },
                  "top_message": 4, "read_inbox_max_id": 4, "read_outbox_max_id": 0,
                  "unread_count": 0,
                  "notify_settings": { "_": "peerNotifySettings" } } ],
  "messages": [ { "_": "message", "id": 4, "…": "…" } ],
  "chats":    [],
  "users":    [ { "_": "user", "id": 2, "first_name": "Bob", "…": "…" } ] }
```
Строка диалога НЕ несёт ни имени, ни аватарки, ни последнего сообщения: объекты
едут ОДИН раз векторами `users`/`chats`/`messages`, а внутри диалога стоят
ссылки (`peer`, `top_message`). Имя собирает клиент из `first_name`/`last_name`
(порт `PeerTitle`) — на проводе `display_name` не существует.

Черновик — параметр САМОГО диалога (`draft`, конструктор `draftMessage`);
«черновика нет» это отсутствие ключа. Отдельным списком он не едет: от даты
черновика зависит место строки в списке, и собирать дату активности из двух
источников значило бы держать порядок в двух местах. Ручка `/drafts` при этом
остаётся — она отдаёт КАДРЫ `updateDraftMessage` (как `messages.getAllDrafts`
у оригинала), которыми клиент заполняет те же диалоги.

---

## Groups

Multi-member chats (`type: "group"`). Membership carries a **role** and, for
admins, a granular **rights** bitmask.

- **Roles** (`chat_members.role`): `creator` | `admin` | `member`.
  - `creator` — implicitly holds **all** rights (never checked against the bitmask).
  - `admin` — holds exactly the rights in its bitmask.
  - `member` — a plain member; holds **no** admin rights.
- **Rights bitmask** (sum the values you want; `admins` only):

  | Right | Value | Grants |
  |-------|------:|--------|
  | `POST_MESSAGES`  | `1`   | post messages |
  | `EDIT_MESSAGES`  | `2`   | edit others' messages |
  | `DELETE_MESSAGES`| `4`   | delete others' messages |
  | `BAN_USERS`      | `8`   | kick/ban members |
  | `INVITE_USERS`   | `16`  | add members, create/list/revoke invite links |
  | `PIN_MESSAGES`   | `32`  | pin messages |
  | `CHANGE_INFO`    | `64`  | edit title/about/username |
  | `MANAGE_ADMINS`  | `128` | promote/demote admins |

  e.g. an admin who may post and invite has `rights = 17` (`1 + 16`).
- **`member_count`** is a denormalized counter on the chat, maintained on add/remove
  (re-adding an existing member or re-removing a non-member does not double-count).
- **Errors:** an action the caller is not entitled to perform (or performs while
  not a member) → `403 {"_": "error", "code": 403, "text": "forbidden"}`.
  A missing chat/member → `404 {"_": "error", "code": 404, "text": "not found"}`.

### POST /groups  · auth
Create a group; the caller becomes its `creator` (with all rights) and first member.
- Request: `{ "title": "Team", "about": "", "username": "", "is_public": false }`
  (`title` required; `about`/`username` optional; `username` only meaningful when public)
- 200: `{ "chat_id": 1 }`
- 400: `{ "_": "error", "code": 400, "text": "title required" }`

### GET /chats/{chatID}/card  · auth
Карточка группы/канала. Ответ — конструктор `messages.chatFull`: полная
карточка ВМЕСТЕ с краткой формой самого чата. Ровно тот же объект приезжает
кадром `chat_update`, поэтому разбирать его вторым путём не нужно.
- 200:
```json
{ "_": "messages.chatFull",
  "full_chat": { "_": "channelFull", "id": 1, "about": "", "participants_count": 3,
                 "read_inbox_max_id": 4, "read_outbox_max_id": 0, "unread_count": 0,
                 "chat_photo": null },
  "chats": [ { "_": "channel", "id": 1, "title": "Team", "date": 0,
               "pFlags": { "megagroup": true, "creator": true },
               "photo": { "_": "chatPhotoEmpty" } } ],
  "users": [] }
```
  - `my_role` больше нет: creator это `pFlags.creator`, admin — НАЛИЧИЕ
    `admin_rights` (решение №3 порта пиров);
  - `is_public` выражено наличием `username`, `default_permissions` —
    инвертированными `default_banned_rights`, `history_for_new` —
    `pFlags.hidden_prehistory` с обратным знаком;
  - наша группа — это тоже `channel` (+ `pFlags.megagroup`, решение №2).
- 404: `{ "_": "error", "code": 404, "text": "not found" }` (no such chat)

### GET /chats/{chatID}/members  · auth
List the chat's members with their role and current online status. The caller
must be a member of the chat. Supports `?offset=` (default `0`) and `?limit=`
(default and max `200`); members are ordered by role then `user_id`.
- 200:
```json
{ "members": [
  { "user_id": 7, "role": "creator", "online": true },
  { "user_id": 9, "role": "member",  "online": false }
] }
```
  `online` reflects realtime presence when enabled; when presence is disabled it
  is always `false` and clients should overlay their own presence store.
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }` (caller is not a member)

### PATCH /chats/{chatID}  · auth · needs `CHANGE_INFO`
Edit group info.
- Request: `{ "title": "New", "about": "desc", "username": "team" }`
- 200: `{ "_": "boolTrue" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### POST /chats/{chatID}/members  · auth · needs `INVITE_USERS`
Add a user as a plain `member`.
- Request: `{ "user_id": 9 }`
- 200: `{ "_": "boolTrue" }`
- 400: `{ "_": "error", "code": 400, "text": "user_id required" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### DELETE /chats/{chatID}/members/{userID}  · auth
Remove a member. Kicking another user needs `BAN_USERS`; removing **yourself**
(self-leave, `userID` == caller) is always allowed.
- 200: `{ "_": "boolTrue" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### POST /chats/{chatID}/admins  · auth · needs `MANAGE_ADMINS`
Promote a member to `admin` with the given rights bitmask.
- Request: `{ "user_id": 9, "rights": 17 }`
- 200: `{ "_": "boolTrue" }`
- 400: `{ "_": "error", "code": 400, "text": "user_id required" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### DELETE /chats/{chatID}/admins/{userID}  · auth · needs `MANAGE_ADMINS`
Demote an admin back to `member` (clears rights).
- 200: `{ "_": "boolTrue" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### POST /chats/{chatID}/mute  · auth
Set the caller's own per-chat mute flag.
- Request: `{ "muted": true }`
- 200: `{ "_": "boolTrue" }`

### POST /chats/{chatID}/invite_links  · auth · needs `INVITE_USERS`
Create an invite link with a random token.
- Request: `{ "usage_limit": 10, "requires_approval": false }`  (`usage_limit` optional/nullable = unlimited; `requires_approval` optional, default `false`)
- 200: `{ "token": "<hex>", "url": "/join/<hex>", "requires_approval": false }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### GET /chats/{chatID}/invite_links  · auth · needs `INVITE_USERS`
List the chat's active (non-revoked) invite links.
- 200: `{ "invite_links": [ { "token": "<hex>", "uses": 3, "url": "/join/<hex>", "requires_approval": false } ] }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### POST /join/{token}  · auth
Join a chat via an invite token. If the link does not require approval the caller
becomes a `member` immediately and the link's `uses` counter increments. If the
link requires approval, a pending join request is recorded instead (idempotent).
- 200: `{ "status": "joined" }` — joined immediately (no approval required)
- 200: `{ "status": "requested" }` — pending admin approval (approval-required link)
- 404: `{ "_": "error", "code": 404, "text": "not found" }` (unknown or revoked token)

### GET /chats/{chatID}/join_requests  · auth · needs `INVITE_USERS`
List pending join requests for the chat.
- 200: `{ "requests": [ { "user_id": 42 } ] }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`

### POST /chats/{chatID}/join_requests/{userID}/approve  · auth · needs `INVITE_USERS`
Approve a pending join request; the user becomes a `member` and the request is removed.
- 200: `{ "_": "boolTrue" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`
- 404: `{ "_": "error", "code": 404, "text": "not found" }`

### POST /chats/{chatID}/join_requests/{userID}/decline  · auth · needs `INVITE_USERS`
Decline (remove) a pending join request.
- 200: `{ "_": "boolTrue" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }`
- 404: `{ "_": "error", "code": 404, "text": "not found" }`

### GET /users?ids=  · auth
Batch-resolve minimal public user cards (for member lists, sender names).
- Query: `ids` — comma-separated int64 ids (e.g. `?ids=1,2,3`). Unknown ids are
  silently skipped; an empty/absent `ids` yields an empty list.
- 200: `{ "users": [ <user>, … ] }` — конструкторы `user` целиком:
```json
{ "_": "user", "id": 1, "first_name": "Alice", "username": "alice",
  "photo": { "_": "userProfilePhoto", "photo_id": 42 },
  "status": { "_": "userStatusOnline", "expires": 1782237080 },
  "pFlags": { "verified": true } }
```
  - `display_name` на проводе НЕ существует: имя собирает клиент из
    `first_name`/`last_name` (порт `PeerTitle`);
  - пять полей аватарки схлопнулись в одно (`photo`), присутствие — в
    объединение `UserStatus` со сроком годности.

---

## Channels

Broadcast chats (`type: "channel"`) that scale to millions of subscribers.
Channels reuse the group machinery — membership, roles, rights, `member_count`,
mute, the info card (`GET /chats/{chatID}/card`) and message **history**
(`GET /chats/{chatID}/history`) are all the same as for groups. Subscribers join
with role `subscriber` (no admin rights); posting is gated by the `POST_MESSAGES`
right (creator/admins only).

**Scalability model — O(1) per post.** Posting does **not** fan out to
subscribers. Each post is one message insert + one bump of the channel's own
`channel_pts` counter + one row appended to the channel's `channel_updates` log +
**one** `PUBLISH channel:{id}` to Redis (no per-subscriber `pts` rows, no
per-subscriber publishes). Live clients receive the post by subscribing the
`channel:{id}` topic over WS (see `subscribe_channel` below); offline/lagging
clients catch up by pulling `GET /channels/{chatID}/difference?pts=`. The
per-channel `pts` is **independent** of the per-user `/sync` `pts` cursor.

### POST /channels  · auth
Create a channel; the caller becomes its `creator` (with all rights) and first member.
- Request: `{ "title": "News", "about": "", "username": "news", "is_public": true }`
  (`title` required; `about`/`username` optional; `username` only meaningful when public)
- 200: `{ "chat_id": 1 }`
- 400: `{ "_": "error", "code": 400, "text": "title required" }`

### POST /channels/{chatID}/messages  · auth · needs `POST_MESSAGES`
Post to a channel. O(1) delivery: insert message → bump `channel_pts` → append a
`channel_updates` row → **one** `PUBLISH channel:{chatID}`. No per-subscriber fan-out.
- Request: `{ "text": "hello world", "client_msg_id": "uuid-from-client" }`
  (`client_msg_id` optional, makes the post idempotent)
- 200: `{ "id": 10, "chat_id": 1, "seq": 5, "created_at": "2026-06-24T10:00:00Z" }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }` (caller lacks `POST_MESSAGES`)

### GET /channels/{chatID}/difference?pts=  · auth
getDifference-style catch-up for a single channel, using the channel's own `pts`.
Membership-gated. The client stores the channel's last seen `pts` and passes it back.
- Query: `pts` (last seen channel pts, default 0).
- 200:
```json
{
  "updates": [
    { "t": "new_message", "pts": 6,
      "d": { "_": "updateNewChannelMessage", "message": {"_":"message", "…":"…"}, "pts": 6, "pts_count": 1 } }
  ],
  "pts": 6,
  "slice": false
}
```
  - конверт строки — ТОТ ЖЕ `{t, pts, d}`, что у живого канального кадра, так
    что клиент прогоняет догон через ту же пер-канальную воронку;
  - в журнале канала лежат три конструктора: `updateNewChannelMessage` (пост),
    `updateChannelFullSnapshot` (снимок карточки) и `updateChannelBoostStatus`
    (бусты). Все три несут ПЕР-КАНАЛЬНЫЙ `pts` — и канальный он потому, что
    таков конструктор, а не потому, что ключ иначе называется;
  - `pts` — наибольший канальный pts пачки (новый курсор);
  - `slice: true` → пачка упёрлась в предел страницы (100); звать снова с новым `pts`.
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }` (caller is not a member/subscriber)

### POST /channels/join  · auth
Join a public channel by its `@username`; the caller becomes a `subscriber`.
- Request: `{ "username": "news" }`
- 200: `{ "_": "boolTrue" }`
- 400: `{ "_": "error", "code": 400, "text": "username required" }`
- 404: `{ "_": "error", "code": 404, "text": "not found" }` (no public chat with that username)

### Discussions (channel-post comments)

A channel can enable **discussions**: a backing `group` chat is auto-created and
linked via the channel's `discussion_chat_id`. Comments are ordinary group
messages stamped with `thread_root_id` = the channel post's message `id`, so they
reuse the standard send path (fan-out + per-user `pts` + live `new_message`).
Commenters auto-join the discussion group on first comment (idempotent).

### POST /channels/{chatID}/discussion  · auth · needs `CHANGE_INFO`
Enable discussions on a channel. Idempotent: returns the existing discussion
group id if already enabled. The caller must be an admin (CHANGE_INFO right).
- 200: `{ "discussion_chat_id": 42 }`
- 403: `{ "_": "error", "code": 403, "text": "forbidden" }` (not allowed to change channel info)
- 404: `{ "_": "error", "code": 404, "text": "not found" }` (channel does not exist)

### POST /channels/{chatID}/posts/{postId}/comments  · auth
Post a comment on the channel post `postId`. The comment is a message in the
linked discussion group with `thread_root_id = postId`. The caller is auto-joined
to the discussion group.
- Request: `{ "text": "nice post", "client_msg_id": "uuid-from-client" }`
- 200: сообщение — тот же конструктор `message`, что и везде; корень треда
  едет ССЫЛКОЙ внутри `reply_to`:
```json
{ "_": "message", "id": 1, "peer_id": { "_": "peerChannel", "channel_id": 42 },
  "from_id": { "_": "peerUser", "user_id": 7 }, "date": 1782237047,
  "message": "nice post",
  "reply_to": { "_": "messageReplyHeader", "reply_to_top_id": 55 } }
```
- 404: `{ "_": "error", "code": 404, "text": "not found" }` (discussions not enabled)

### GET /channels/{chatID}/posts/{postId}/comments  · auth
List the comment thread (ascending by `seq`) for a channel post, plus the total
count.
- Query: `offset` (default 0), `limit` (default 50, max 100).
- 200: контейнер `messages.messagesSlice` — те же конструкторы внутри.
- 404: `{ "_": "error", "code": 404, "text": "not found" }` (discussions not enabled)

### GET /channels/{chatID}/comment_counts?ids=  · auth
Return comment counts for a batch of channel posts. Returns `0` (or omits) for
posts with no comments and `{}` when discussions are not enabled.
- Query: `ids` — CSV of post message ids, e.g. `?ids=55,56,57`.
- 200: `{ "counts": { "55": 1, "56": 0 } }` (JSON object keys are post id strings)

### POST /chats/{chatID}/pin  · auth
Pin/unpin the dialog at the top of the chat list (per-user). At most **5**
pinned dialogs in the main list (archive not counted) — exceeding returns 400
`pin limit reached`. Pinning order: newest pin first. Fans out `dialog_pin`
`{chat_id, pinned}` to the owner's devices over WS.
- Request: `{ "pinned": true }`
- 200: `{ "_": "boolTrue" }`

### POST /chats/{chatID}/archive  · auth
Move the dialog to/from the archive (per-user, tweb folder_id 0↔1). Archiving
clears the dialog's pin. Fans out `dialog_archive` `{chat_id, archived}` to the
owner's devices over WS.
- Request: `{ "archived": true }`
- 200: `{ "_": "boolTrue" }`

### POST /chats/{chatID}/polls  · auth
Send a poll (a message of type `poll`). Question ≤255 chars, 2..10 non-empty
options ≤100 chars each. `quiz` forces single-choice and requires
`correct_option` (index). The `new_message` WS frame carries the poll view.
- Request: `{ "question": "?", "options": ["a","b"], "anonymous": true, "multiple": false, "quiz": false, "correct_option": null, "client_msg_id": "" }`
- 200: the created Message (includes `poll_id` + `poll`)
- 400 invalid poll · 403 not a member

### POST /polls/{pollID}/vote  · auth
Replace the caller's vote. Empty `options` retracts (not for quizzes; quiz
answers are final). Fans out `poll_update` `{chat_id, poll}` (aggregates, no
`my_votes`) to all chat members over WS.
- Request: `{ "options": [1] }`
- 200: `{ "poll": PollInfo }` — the viewer's poll view: `{id, question, options,
  anonymous, multiple, quiz, closed, correct_option?, counts, total_voters,
  my_votes}`. `correct_option` is revealed only when the quiz is closed or the
  viewer has answered.
- 400 invalid vote (closed / bad indexes / quiz re-vote) · 404 unknown poll

### POST /polls/{pollID}/close  · auth
Stop the poll (author of the poll message or chat admin/creator). Voting stops,
a quiz reveals its answer. Fans out `poll_update`.
- 200: `{ "_": "boolTrue" }` · 403 not allowed

### GET /chats/{chatID}/group_call  · auth
Participants of the chat's active group call/video chat (empty when none).
→ `{ "participants": [3,4] }`. Used to show the «Video Chat … Join» banner and,
on join, to know whom to send WebRTC offers to (mesh).

**WS frames (group calls, server is a dumb relay + participant set):**
- `group_call_join {chat_id}` / `group_call_leave {chat_id}` (client→server): join/leave;
  the server updates the Redis participant set and fans out `group_call_update`
  `{chat_id, user_id, action:"joined"|"left", participants:[…]}` to all chat members.
  A dropped socket auto-leaves.
- `group_call_signal {chat_id, to_user_id, sdp?|candidate?|media_state?}` (client→server):
  addressed relay of WebRTC SDP/ICE/mute+video state; re-addressed to `to_user_id`
  with `from_user_id` stamped in.

### POST /chats/{chatID}/forum  · auth
Enable/disable forum topics on a group (needs CHANGE_INFO). `{ "enabled": true }` → `{ "_": "boolTrue" }`.
Dialogs expose `is_forum`; a forum chat renders a topic list instead of the feed.

### POST /chats/{chatID}/topics  · auth
Create a topic (any member): a service root message + a `forum_topics` row.
Topic messages are thread messages (`thread_root_id` = the topic's `root_msg_id`)
sent through the normal POST /chats/{id}/messages.
- Request: `{ "title": "Ideas", "icon_color": 2 }` (title ≤128; color = index into the tweb TOPIC_COLORS palette)
- 200: `{ id, chat_id, root_msg_id, title, icon_color, closed, created_by, created_at, … }`

### GET /chats/{chatID}/topics  · auth
Topics with their thread's last message (`last_text/last_type/last_sender_name/last_at`)
and `msg_count`, freshest first. → `{ "topics": [ … ] }`

### POST /chats/{chatID}/topics/{topicID}/close  · auth
Close/reopen a topic (topic author or chat admin). `{ "closed": true }` → `{ "_": "boolTrue" }`.

### GET /chats/{chatID}/threads/{rootID}  · auth
Messages of a thread (forum topic) ascending: `?offset&limit` → контейнер
`messages.messagesSlice`.

### POST /chats/{chatID}/scheduled  · auth
Schedule a message (Telegram scheduled messages): it sits in a per-user queue
and enters the chat history only at `send_at` (a background worker dispatches
due entries through the normal Send fan-out every ~15s). Text or media
required; `send_at` must be in the future; at most 100 pending per user.
- Request: `{ "type": "text", "text": "hi", "entities": null, "reply_to_id": null, "media_id": null, "send_at": 1784350000 }`
- 200: отложенная запись — конструктор `message` с `pFlags.is_scheduled` и
  параметром `send_at` (клиентское поле, объявленное штатным механизмом
  `schema_additional_params.json`)
- 400 invalid (empty/past/limit) · 403 not a member

### GET /chats/{chatID}/scheduled  · auth
The caller's OWN scheduled messages in the chat, soonest first.
- 200: `{ "scheduled": [ … ] }`

### DELETE /chats/{chatID}/scheduled/{schedID}  · auth
Remove own scheduled message. 403 when not the author.

### POST /chats/{chatID}/scheduled/{schedID}/send_now  · auth
Send own scheduled message immediately (tweb Send Now). Returns the created
Message; the queue entry is removed.

### GET /search?q=  · auth
Global directory search: public chats (channels/public groups) by `@username` or
title prefix, plus users by `username`/имени (колонка `users.display_name`
остаётся ПОИСКОВОЙ, на провод она не выходит). Private chats are
never returned. Both lists are capped at 20 and ordered (chats by `member_count`).
- Query: `q` — search prefix (empty `q` yields empty results).
- 200 — конструктор `contacts.found`: найденное едет ССЫЛКАМИ (`results`), а
  сами объекты — векторами `chats`/`users`, один раз каждый:
```json
{ "_": "contacts.found",
  "my_results": [],
  "results": [ { "_": "peerChannel", "channel_id": 1 }, { "_": "peerUser", "user_id": 2 } ],
  "chats": [ { "_": "channel", "id": 1, "title": "News", "username": "news", "…": "…" } ],
  "users": [ { "_": "user", "id": 2, "username": "alice", "…": "…" } ] }
```

### GET /search/messages?q=&filter=  · auth
Global message search across every chat the caller is a member of (sidebar
search: «Сообщения» section + Media/Links/Files/Music/Voice tabs). Matches
message text or attached file name (case-insensitive substring). Visibility
mirrors history: deleted messages, per-user hides and hidden pre-join history
are excluded. Newest first.
- Query: `q` — substring (optional when `filter` set); `filter` — one of
  `media|links|files|music|voice` (empty = any type; empty `q` AND empty
  `filter` yields empty results); `offset` (default 0); `limit` (default 20, max 50).
- 200: контейнер `messages.messagesSlice` (`count` = total matches)

---

## Messages & history

### POST /chats/{chatID}/messages  · auth
Send a message. Also delivered live over WS (`new_message`) to all members.
- Request:
```json
{ "type": "text", "text": "hello", "reply_to_id": null,
  "client_msg_id": "uuid-from-client", "media_id": null }
```
  - `type` defaults to `text`. `client_msg_id` (optional) makes the send idempotent.
  - `media_id` (optional) must reference media **owned by the sender**.
  - `type: "geo"`: обязательны `geo_lat`/`geo_lng` (валидный диапазон координат);
    в DTO сообщения возвращается `geo: { lat, lng }`.
  - `type: "contact"`: обязателен `contact_user_id` (существующий аккаунт); сервер
    сам гидрирует снимок имени/телефона — в DTO приходит
    `contact: { user_id, name, phone }`. Те же поля принимает WS `send_message`
    и несёт фрейм `new_message`.
- 200 (the created or deduplicated message) — конструктор `message` схемы:
```json
{ "_": "message", "id": 5, "peer_id": { "_": "peerUser", "user_id": 2 },
  "from_id": { "_": "peerUser", "user_id": 1 }, "date": 1782237047,
  "message": "hello", "pFlags": { "out": true } }
```
  - `id` — номер сообщения ВНУТРИ пира (наш `seq`), а не ключ строки;
  - вложение любого вида живёт в ОДНОМ параметре `media` (объединение
    `MessageMedia`), ответ — ССЫЛКОЙ `reply_to`, а не снимком оригинала;
  - булевы флаги — в `pFlags`, и «выключено» значит ОТСУТСТВИЕ ключа: `out`
    пер-зрительский и приезжает только автору;
  - служебное сообщение — ВТОРОЙ конструктор объединения (`messageService`
    с параметром `action`), а не поле `type: "service"`.
- 403: `{ "_": "error", "code": 403, "text": "not a member of this chat" }` (also when attaching media you don't own)

### GET /chats/{chatID}/history  · auth
Paginated window, like Telegram `messages.getHistory`.
- Query: `offset_id` (reference `seq`; `0`/absent = newest), `add_offset`
  (`>0` → older than offset, `<=0` → newer than offset), `limit` (default 40, max 100).
- `thread_root=<msgID>` (optional) ограничивает окно тредом (форум-топик /
  комментарии): сообщения с этим `thread_root_id` плюс само корневое сообщение.
  Работает и с `around`. Тред discussion-группы канала читается и НЕ-членом
  (комментарии доступны без вступления, как `GET /channels/... /comments`);
  отправка в такой тред (`thread_root_id` в send) авто-вступает в группу.
- 200: контейнер `messages.messagesSlice` (messages newest-first when paging from the end)
- 403: `{ "_": "error", "code": 403, "text": "not a member of this chat" }`

### POST /chats/{chatID}/read  · auth
Mark read up to a sequence; fans out a read receipt. The marker never moves
backwards (a stale lower `up_to_seq` is a no-op).
- Request: `{ "up_to_seq": 5 }`
- 200: `{ "_": "boolTrue" }`
- 403: `{ "_": "error", "code": 403, "text": "not a member of this chat" }`

---

## Reactions

### POST /chats/{chatID}/messages/{msgID}/reactions  · auth
- Request: `{ "emoji": "🔥" }`  (non-empty, ≤32 bytes, valid UTF-8)
- 200: `{ "_": "boolTrue" }`
- 400: `{ "_": "error", "code": 400, "text": "invalid reaction" }`
- 404: `{ "_": "error", "code": 404, "text": "message not found" }` (also when the message isn't in this chat / no access)

### DELETE /chats/{chatID}/messages/{msgID}/reactions/{emoji}  · auth
`{emoji}` is URL-escaped (e.g. `%F0%9F%94%A5`).
- 200: `{ "_": "boolTrue" }` · 400 invalid · 404 not found

### GET /chats/{chatID}/messages/{msgID}/reactions  · auth
- 200: `{ "reactions": [ { "emoji": "🔥", "count": 2, "mine": true }, { "emoji": "❤️", "count": 1 } ] }` (most popular first; `mine` — зритель тоже поставил эту реакцию, omitted when false)
- 404: `{ "_": "error", "code": 404, "text": "message not found" }`

Message DTO истории (`GET /chats/{chatID}/messages`, `/messages/around`) несёт те же
агрегаты полем `reactions` (omitted, когда реакций нет) — клиент рендерит чипы без
отдельного GET. Live-обновления приходят дельтами кадром `reaction` (см. WS).

---

## Sync (catch-up)

### GET /sync  · auth
getDifference-style catch-up of updates the client missed. The client stores
`state.pts` and passes it back as the cursor.
- Query: `pts` (last seen pts, default 0), `date` (default 0).
- 200:
```json
{
  "new_messages":  [ { "t":"new_message", "pts":6, "d": { "_":"updateNewMessage", "message": {"_":"message", "…": "…"}, "pts":6, "pts_count":1 } } ],
  "other_updates": [ { "t":"read", "pts":7, "d": { "_":"updateReadHistoryInbox", "peer": {"_":"peerUser","user_id":2}, "max_id":10, "still_unread_count":0, "pts":7, "pts_count":1 } } ],
  "state": { "pts": 7, "date": 1782237047655 },
  "slice": false,
  "too_long": false
}
```
  - Тело строки (`d`) — ТОТ ЖЕ конструктор, что приезжает живым кадром: журнал
    хранится в форме МОДЕЛИ, а провод собирается из неё на выходе. `t` — тип
    строки журнала; клиент маршрутизирует по дискриминатору `d._`.
  - `pts` строки лежит СНАРУЖИ у всех: у догона курсор задаёт сам журнал, а не
    конструктор (у живого кадра он либо в теле, либо в конверте — см. раздел WS).
  - `slice: true` → more updates remain; call `/sync` again with the new `state.pts`.
  - `too_long: true` → the client is too far behind; discard local cache and do a full resync.

---

## Media

Bytes never pass through the backend: the client uploads to / downloads from
object storage (MinIO/S3) using presigned URLs. Download URLs support HTTP Range.

### POST /media/upload  · auth
Register metadata and get a presigned PUT URL; then PUT the bytes to it directly.
- Request:
```json
{ "mime": "image/jpeg", "size": 20480, "width": 800, "height": 600,
  "duration": 0, "blur_preview": "<base64 LQIP>" }
```
  - `size` in bytes, `1..104857600` (100 MiB).
- 200: `{ "media_id": 1, "object_key": "1/ab12…", "upload_url": "https://minio/…?X-Amz-…" }`
- 400: `{ "_": "error", "code": 400, "text": "invalid size" }`  · 413: `{ "_": "error", "code": 413, "text": "file too large" }`
- Then: `PUT <upload_url>` with the raw bytes (direct to storage). Then send a
  message with `media_id`.

### GET /media/{mediaID}  · auth
Resolve media to metadata + a presigned GET (download) URL. Allowed only if the
caller **owns** the media or **shares a chat** with a message referencing it.
- 200:
```json
{ "id": 1, "mime": "image/jpeg", "size": 20480, "width": 800, "height": 600,
  "duration": 0, "blur_preview": "<base64>", "download_url": "https://minio/…?X-Amz-…" }
```
- 404: `{ "_": "error", "code": 404, "text": "media not found" }` (also when not authorized — no enumeration leak)
- The `download_url` honors `Range: bytes=…` → `206 Partial Content` (streaming).

### PUT /media/{mediaID}/content  · auth (Bearer, owner)
Stream the raw object bytes through the backend into storage. The body is the
raw file bytes; `Content-Type` should be the media's mime. Only the **owner**
may upload; the body is capped at 100 MiB.
- Request: raw bytes (not JSON).
- 204: success (no body).
- 403: `{ "_": "error", "code": 403, "text": "not your media" }` (caller is not the owner).
- 404: `{ "_": "error", "code": 404, "text": "media not found" }`.

### GET /media/{mediaID}/content?token=<session-token>  · token-query auth
Stream the object bytes back through the backend. Browser `<img>`/`<video>`
elements can't send an `Authorization` header, so this endpoint authenticates via
the `?token=` **query parameter** (the same mechanism as `/ws`) and is mounted
**outside** the Bearer group. The worker builds the URL (token stays in the
worker); the UI drops the string into `src`. Access is checked exactly like
`GET /media/{mediaID}` (owner or shares a chat referencing the media).
- Streams bytes and honors `Range: bytes=…` → `206 Partial Content` (via
  `http.ServeContent`); sets `Content-Type` (declared mime) and a long
  `Cache-Control: private, max-age=31536000, immutable`.
- 401: `{ "_": "error", "code": 401, "text": "invalid token" }` (missing/invalid `token`).
- 404: `{ "_": "error", "code": 404, "text": "media not found" }` (no access — no enumeration leak).

---

## Web Push

Push is sent only when a recipient has **no active WebSocket** and has **not muted**
the chat. Subscriptions are per device. Requires the server to have VAPID keys set.

### GET /push/vapid_public_key  · auth
- 200: `{ "public_key": "<base64 VAPID public key>" }`

### POST /push/subscribe  · auth
Register the current device's browser push subscription.
- Request: `{ "endpoint": "https://fcm…", "p256dh": "<key>", "auth": "<key>" }`
- 200: `{ "_": "boolTrue" }` · 400 missing fields

### Push payload (delivered to the Service Worker)
```json
{ "chat_id": 1, "msg_id": 10, "seq": 5,
  "sender": { "name": "Alice" }, "text": "hello", "badge": 3 }
```
The Service Worker checks for an active window, muted state, and passcode lock
before showing the notification; clicking it focuses/opens the chat.

---

## Stories

24h ephemeral posts backed by a media object. Visibility is by privacy:
`everyone` / `contacts` (chat partners) / `close` (close friends) / `selected`
(an explicit allow-list) — на проводе это ФЛАГИ истории, а не строка.
The feed shows the viewer's own active stories plus those of their chat
partners; expired stories (created more than 24h ago) are filtered out on read.

### POST /stories  · auth
Post a story from a media object the caller owns.
- Request: `{ "media_id": 5, "caption": "hi", "privacy": "contacts", "allow_user_ids": [7],
  "media_areas": [ <MediaArea>, … ] }`
  (`caption` optional; `privacy` defaults to `contacts`; `allow_user_ids` used only when `privacy="selected"`)
- 200: `{ "id": 1 }` · 400 missing `media_id` · 403 media not owned by caller

Интерактивные области едут КОНСТРУКТОРАМИ объединения `MediaArea` —
`mediaAreaGeoPoint` / `mediaAreaVenue` / `mediaAreaSuggestedReaction` /
`mediaAreaUrl` — и в запросе, и в ответе, и в колонке. Область неизвестного
конструктора отбрасывается, а не едет полупустой записью.

### GET /stories  · auth
The viewer's active story feed (own group first). Ответ — КОНТЕЙНЕР
`stories.allStories`: группы ссылаются на автора, а карточки авторов едут ОДИН
раз вектором `users` — то же решение, что у контейнера `/chats`.
- 200:
```json
{ "_": "stories.allStories", "count": 1,
  "peer_stories": [
    { "_": "peerStories", "peer": { "_": "peerUser", "user_id": 1 },
      "stories": [ { "_": "storyItem", "pFlags": { "public": true }, "id": 1,
                     "date": 1787334148, "expire_date": 1787420548, "caption": "hi",
                     "media": { "_": "messageMediaPhoto", "photo": { "…": "…" } },
                     "views": { "_": "storyViews", "views_count": 3, "reactions_count": 1,
                                "reactions": [ { "_": "reactionCount", "…": "…" } ] },
                     "sent_reaction": { "_": "reactionEmoji", "emoticon": "❤" } } ] }
  ],
  "chats": [], "users": [ { "_": "user", "id": 1, "…": "…" } ],
  "stealth_mode": { "_": "storiesStealthMode" } }
```
Что стоит знать про историю:

- **`media` обязателен и это СТУПЕНЬ** — та же, что у вложения сообщения.
  Плоского `media_id` рядом больше нет: размеры, mime и длительность приезжают
  вместе с историей, а не отдельным запросом на каждую;
- **вид аудитории — ФЛАГИ** (`public`/`contacts`/`close_friends`/
  `selected_contacts`), а сама аудитория — `privacy: Vector<PrivacyRule>`,
  который едет ТОЛЬКО автору истории;
- **«моя реакция» — `sent_reaction`**, отдельный параметр самой истории:
  счётчики и разбивка общие на всех получателей и лежат в `views`;
- **даты — секунды эпохи** (`date`/`expire_date`), как у сообщения;
- **`id` — НОМЕР ВНУТРИ АВТОРА**, а не глобальный ключ: им история адресуется
  (`/stories/{peerID}/{storySeq}/…`) и по нему же считается горизонт прочтения.
  У разных авторов номера совпадают — сам по себе номер историю не адресует;
- **прочитанность — ГОРИЗОНТ группы** (`peerStories.max_read_id`), один номер на
  автора: «непрочитанная» это `story.id > max_read_id`, ровно как непрочитанность
  сообщения по `read_inbox_max_id`. Признака на самой истории нет.

Архив и закреплённые (`GET /stories/archive`, `GET /stories/pinned`) отвечают
контейнером `stories.stories` теми же конструкторами.

### POST /stories/{peerID}/{storySeq}/view  · auth
Отметить историю просмотренной. Идемпотентно. Делает ДВА разных дела, потому что
это два разных факта: пишет просмотр (`кто посмотрел` — витрина
`/viewers`) и двигает ГОРИЗОНТ прочтения (только вперёд). У оригинала это два
метода (`stories.incrementStoryViews` и `stories.readStories`); одна ручка —
названное упрощение: интерфейс всё равно зовёт их вместе.

Сдвиг горизонта уезжает кадром `updateReadStories` на ДРУГИЕ устройства зрителя.
- 200: `{ "_": "boolTrue" }` · 403 story not visible to caller

### GET /stories/{peerID}/{storySeq}/viewers  · auth · author only
Who has seen the story (author-gated). Ответ — контейнер
`stories.storyViewsList`: сам просмотр и карточка зрителя едут РАЗНЫМИ
векторами, поэтому дата просмотра и реакция зрителя больше не теряются.
- 200:
```json
{ "_": "stories.storyViewsList", "count": 1, "views_count": 1,
  "forwards_count": 0, "reactions_count": 1,
  "views": [ { "_": "storyView", "user_id": 2, "date": 1787334148,
               "reaction": { "_": "reactionEmoji", "emoticon": "❤" } } ],
  "chats": [], "users": [ { "_": "user", "id": 2, "…": "…" } ] }
```
- 403 caller is not the author

### DELETE /stories/{peerID}/{storySeq}  · auth · author only
Delete the caller's own story.
- 200: `{ "_": "boolTrue" }`

---

## Конфиденциальность

Настройка одного ключа — ВЕКТОР правил, а не запись «значение строкой плюс два
списка исключений». Так устроено объединение `PrivacyRule` схемы, и так же
выражается аудитория истории (тот же предмет, те же конструкторы).

Ключ адресуется КОНСТРУКТОРОМ `PrivacyKey`, а спрашивается по одному — как
`account.getPrivacy` у оригинала. Ручки «все правила разом» нет: у ответа
`account.privacyRules` параметра ключа не бывает, его знает спросивший.

### GET /me/privacy/{key} · auth
`{key}` — конструктор: `privacyKeyPhoneNumber`, `privacyKeyAddedByPhone`,
`privacyKeyStatusTimestamp`, `privacyKeyProfilePhoto`, `privacyKeyAbout`,
`privacyKeyBirthday`, `privacyKeyPhoneCall`, `privacyKeyForwards`,
`privacyKeyChatInvite`, `privacyKeyVoiceMessages` — плюс два НАШИХ:
`privacyKeyMessages` и `privacyKeyReadTime` (у оригинала тот же предмет живёт
двузначными флагами `globalPrivacySettings`, а наш экран предлагает им тот же
выбор из трёх, что и остальным ключам).

```json
{ "_": "account.privacyRules",
  "rules": [ { "_": "privacyValueAllowUsers", "users": [7] },
             { "_": "privacyValueDisallowUsers", "users": [8] },
             { "_": "privacyValueAllowContacts" } ],
  "chats": [], "users": [] }
```

Порядок правил значим: исключения идут ПЕРЕД базовым значением — правило,
поставленное после «всем», уже ничего не изменит.

- 404 — ключ неизвестен.

### PUT /me/privacy/{key} · auth
Тело — тот же вектор: `{ "rules": [ … ] }`. Ответ — `account.privacyRules`.

## System / docs

- `GET /health` → `{ "status": "ok" }`
- `GET /openapi.yaml` → the OpenAPI 3 spec (YAML)
- `GET /swagger` → Swagger UI

---

## WebSocket — realtime

### Connect
`GET /ws` → HTTP 101 (Upgrade). Токен едет ПОДПРОТОКОЛОМ, а не в query: строка
запроса оседает в логах прокси и в истории браузера.

    Sec-WebSocket-Protocol: bearer, <session-token>

Сервер обязан выбрать подпротокол и эхает `bearer` (без выбора браузер закроет
соединение). Устаревший `?token=` пока принимается — для вкладок, открытых до
раскатки. Невалидный/отсутствующий токен → 401 без апгрейда.

Перед `bearer` клиент может попросить ФОРМАТ кадров:

| подпротокол | что значит |
|---|---|
| `tl.1` | кадры-апдейты приезжают байтами TL (см. ниже). Сервер эхает `tl.1` |
| `dnp.2` | Noise-канал (аутентификация внутри канала, токен не в подпротоколе) |
| — | кадры приезжают JSON-текстом; умолчание |

Формат — свойство СОЕДИНЕНИЯ: соседняя вкладка того же пользователя может
остаться на JSON. Обе формы собираются из одной модели.

### Формат кадра

**JSON (умолчание).** Конверт: `{ "t": "<type>", "d": { … }, "pts": <int>? }`.

`pts` в конверте — плотный пер-юзерный курсор кадра, и он появляется там ТОЛЬКО
у кадров, чей конструктор схемы своего параметра `pts` не объявляет
(`updateMessageReactions` и далее кадры диалогов). У оригинала такие апдейты
едут в контейнере `updates`, и порядок им задаёт `seq` контейнера; наш конверт —
тот же контейнер. У кадров с параметром `pts` (`updateNewMessage`,
`updateReadHistoryInbox`, …) курсор лежит ВНУТРИ `d`, и в конверте его нет —
одно число в двух местах не дублируется.

**TL (`tl.1`).** Конверта нет: поток начинается четырьмя байтами id
конструктора. Оболочку даёт схема, и форм у неё две:

| оболочка | когда | где курсор |
|---|---|---|
| `updateShort{update, date}` | конструктор апдейта объявляет `pts` | внутри апдейта |
| `updates{updates, users, chats, date, seq}` | не объявляет | `seq` контейнера |

Векторы `users`/`chats` контейнера пока пустые.

Разделение форм на одном соединении не требует второго признака: **текстовое**
сообщение WS — это JSON-конверт кадра, у которого конструктора нет; **бинарное**
— оболочка `Updates`. Кадр без конструктора уезжает JSON-текстом даже на
проводе TL.

### Client → server
| `t` | `d` | Effect |
|-----|-----|--------|
| `send_message` | `{ peer_id, type?, text?, entities?, reply_to_id?, reply_to_peer_id?, client_msg_id, media_id?, thread_root_id?, … }` | То же, что `POST /chats/{id}/messages`; отвечает `message_ack` и рассылает `new_message` |
| `read` | `{ peer_id, up_to_seq }` | То же, что `POST /chats/{id}/read`; рассылает `read` |
| `read_media` | `{ peer_id, id }` | Вложение прослушано; рассылает `media_read` |
| `typing` | `{ peer_id, action: { _ } }` | Эфемерно; `action` — конструктор `SendMessageAction` (`sendMessageTypingAction`, `sendMessageRecordAudioAction`, …), а не строка |
| `subscribe_channel` | `{ peer_id }` | Подписать это соединение на живые посты канала (Hub лениво входит в Redis-топик `channel:{id}`) |
| `unsubscribe_channel` | `{ peer_id }` | Отписать; снимается и автоматически на разрыве |
| `ping` | — | Сервер отвечает `{ "t": "pong" }` |

Направление клиент→сервер остаётся JSON на любом проводе: там МЕТОДЫ, а не
апдейты, и их порт — отдельная работа.

### Server → client: апдейты
Тело кадра — КОНСТРУКТОР объединения `Update` схемы; `t` конверта существует
только на JSON-проводе и дублирует дискриминатор. Клиент ветвится по `_`.

| `t` | конструктор `d._` | что несёт |
|-----|-----|-----|
| `new_message` | `updateNewMessage` · `updateNewChannelMessage` | сообщение ЦЕЛИКОМ (`message`); второй конструктор — пост канала, у него пер-канальный курсор |
| `edit_message` | `updateEditMessage` | сообщение целиком, а не патч полей |
| `delete_message` | `updateDeletePeerMessages` | наш конструктор: схемный `updateDeleteMessages` пира не несёт, а у нас номер пер-чатный |
| `read` | `updateReadHistoryInbox` · `updateReadHistoryOutbox` | «прочитал я» (со `still_unread_count`) и «прочитали меня» (только горизонт) — РАЗНЫЕ кадры |
| `media_read` | `updateReadPeerMessagesContents` | наш конструктор, причина та же, что у удаления |
| `pin_message` | `updatePinnedMessages` | «открепили» — ТОТ ЖЕ конструктор с опущенным битом `pFlags.pinned` |
| `reaction` | `updateMessageReactions` | АБСОЛЮТНЫЙ агрегат с `pFlags.min`; платная ⭐-реакция — чип `reactionPaid` в том же векторе |
| `draft_update` | `updateDraftMessage` | «черновик снят» — конструктор `draftMessageEmpty` внутри |
| `dialog_pin` | `updateDialogPinned` | `peer: dialogPeer`; закрепление — бит |
| `dialog_archive` | `updateFolderPeers` | вектор `folderPeer` с НОМЕРОМ папки; возврат из архива — папка 0 |
| `dialog_mute` | `updateNotifySettings` | `peer: notifyPeer`, настройки ЦЕЛИКОМ (мьют это срок, а не флаг) |
| `typing` | `updateUserTyping` · `updateChannelUserTyping` | в личном чате пир — сам печатающий; действие — конструктор `SendMessageAction` |
| `presence` | `updateUserStatus` | объединение `UserStatus`; «онлайн» несёт `expires`, скрытое приватностью выражает сам конструктор |
| `user_update` | `updateUserSnapshot` | наш конструктор: карточка внутри кадра, потому что контейнера с вектором `users` у нас ещё нет |
| `poll_update` | `updateMessagePoll` | опрос адресуется своим id |
| `checklist_update` | `updateMessageToDo` | наши конструкторы: апдейтов у предмета в схеме нет |
| `giveaway_update` | `updateMessageGiveaway` | то же |
| `web_page_update` | `updateMessageWebPage` | карточка тем же конструктором, что и внутри сообщения |
| `factcheck_update` | `updateMessageFactCheck` | «проверку сняли» — ОТСУТСТВИЕ параметра |
| `paid_media_unlock` | `updateMessageExtendedMedia` | ровно вектор позиций, ставших настоящими |
| `chat_removed` | `updateChatRemoved` | наш конструктор; поле `removed: true` было константой и ушло |
| `chat_theme_update` | `updateChatTheme` | пустой `theme_id` — сброс к умолчанию |
| `chat_update` | `updateChatFullSnapshot` · `updateChannelFullSnapshot` | АБСОЛЮТНЫЙ снимок `messages.chatFull`; второй конструктор — журнал КАНАЛА (пер-канальный курсор) |
| `boost_update` | `updateChannelBoostStatus` | `premium.boostsStatus` без пер-зрительской части |
| `balance_update` | `updateStarsBalance` | `starsAmount{amount, nanos}` — звёзды дробные |
| `bot_callback_answer` | `updateBotCallbackAnswer` | наш конструктор; «модалкой» — бит `pFlags.alert` |
| `story_update` | `updateStory` | история ЦЕЛИКОМ — тем же конструктором, что на витрине; «её удалили» это `storyItemDeleted` внутри, а не отдельный кадр |
| `story_reaction` | `updateSentStoryReaction` | МОЙ выбор, эхо на другие устройства зрителя; общий агрегат едет внутри истории |
| `story_read` | `updateReadStories` | ГОРИЗОНТ прочтения историй автора сдвинулся — на другие устройства зрителя |

### Server → client: кадры БЕЗ конструктора
Эти уезжают JSON-текстом всегда, и причин ровно две.

**Транспорт** — апдейтами не становятся (у оригинала их роль играют слои
MTProto, которых мы не портируем):

| `t` | `d` |
|-----|-----|
| `hello` | `{ pts, date }` — первый кадр соединения (быстрый reconnect без REST) |
| `pong` | — |
| `message_ack` | `{ client_msg_id, id, created_at }` (отправителю) |
| `message_error` | `{ client_msg_id, reason }` |
| `secret_chat_request` · `secret_chat_accept` · `secret_chat_reject` | хендшейк E2E |
| `call_*` · `group_call_*` · `livestream_*` | сигналинг (сервер — тупой ретранслятор) |

**Предмет не портирован** — уйдут отсюда, когда появятся их объекты:

| `t` | чего ждёт |
|-----|-----|
| `folder_update` | порта самой папки (`dialogFilter` несёт `TextWithEntities` и `Vector<InputPeer>`). Курсор кадр НЕСЁТ — это единственный логируемый кадр без конструктора |
| `geo_live_update` | у оригинала кадра нет вовсе: движение точки это ПРАВКА сообщения |
| `suggested_post_update` | порта `SuggestedPostInfo` |

### Delivery guarantees
- WS is an accelerator, not the source of truth. Every `new_message`/`read`/
  `reaction` is also recorded in the per-user `pts` log, so anything missed
  while disconnected is recovered via `GET /sync`.
- On a slow client, live frames may be dropped (bounded send buffer) — the client
  reconciles via `/sync`.
- **Channels** use a separate, **topic-based** delivery path that scales O(1) per
  post: each post is published **once** to the Redis topic `channel:{id}` (no
  per-subscriber fan-out, no per-subscriber `pts` rows). A client opts in per
  channel via `subscribe_channel {peer_id}`; the Hub joins the `channel:{id}` topic
  on the first local subscriber and routes incoming posts (`new_message`) only to
  the connections that subscribed it, leaving the topic once the last one drops.
  Missed channel posts are recovered per-channel via
  `GET /channels/{id}/difference?pts=` (the channel's own `pts`, independent of the
  per-user `/sync` cursor); channel **history** is the regular
  `GET /chats/{id}/history`.
- Heartbeat: server pings ~every 25s; the client should respond (WS pong) or send
  `{"t":"ping"}`. Presence stays "online" while heartbeats arrive (TTL ~35s).
