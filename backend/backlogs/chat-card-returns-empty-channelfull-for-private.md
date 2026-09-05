# `GET /chats/{id}/card` отвечает пустой (но валидной) `channelFull` для приватного диалога

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** ветка `feat/profile-solid`, задача 2 («каркас
`peerProfile.solid.tsx` и шов с панелью») — 2026-09-05, находка ревью задачи 1.5.

## Что происходит

`GroupRepo.Card` (`internal/adapter/repo/postgres/grouprepo.go:375-449`) читает
строку чата по `chatID` без фильтра по типу:

```sql
SELECT c.id, c.type, c.title, ...
  FROM chats c
  LEFT JOIN media pm ON pm.id = c.photo_media_id
  LEFT JOIN chat_theme ct ON ct.chat_id = c.id
  LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=$2
 WHERE c.id=$1
```

`c.type` попадает в `domain.ChatRecord`, но НИКТО его не проверяет — ни сам
`Card`, ни его единственный HTTP-вызывающий:

- Маршрут `GET /chats/{peerID}/card` → `GroupHandler.Card`
  (`internal/adapter/delivery/http/group_handler.go:588-614`);
- `{peerID}` резолвится в `chatID` хелпером `peerChatID`
  (`internal/adapter/delivery/http/peerparam.go:50-56` → `resolvePeer`):
  для ПОЗИТИВНОГО id (приватный диалог с пользователем) это штатно и
  успешно находит/заводит внутреннюю строку `chats` типа `private` —
  сама модель диалогов ожидает, что у каждого приватного диалога есть
  такая строка («chatAddress», см. фронтовый докблок
  `web-client/src/core/peers/peerId.ts`: «строка в chats для приватного
  диалога осталась внутренней деталью сервера»);
- `GroupHandler.Card` зовёт `h.uc.ChatCard(ctx, chatID, user.ID)` →
  `GroupRepo.Card` без какой-либо проверки `c.Type` до или после чтения;
- ответ уходит ОДНИМ конструктором `domain.NewMessagesChatFull(c.ToChannelFull(), c.ToChannel())`
  (`group_handler.go:614`) — `ChatRecord.ToChannelFull()`
  (`internal/domain/chat.go:406-422`) СОБИРАЕТ `ChannelFull` из ЛЮБОЙ строки
  `ChatRecord`, тоже не глядя на `Type`.

Итог: для позитивного id, за которым стоит приватный диалог, ручка отвечает
`200 OK` с ВАЛИДНОЙ по форме, но ПУСТОЙ (либо бессмысленной — там, где
`chat_members`/`chat_theme` совпали по `chat_id` случайно) `channelFull`,
вместо ошибки. Ни один слой (репозиторий, usecase, хендлер) не возвращает
`ErrInvalid`/`ErrNotFound` на этот случай.

## Почему это не 404 уже сегодня

`WHERE c.id=$1` находит строку — она ЕСТЬ (приватный диалог физически хранится
в `chats`), просто это не тот конструктор, который просил зритель. `errors.Is(err, pgx.ErrNoRows)`
(`grouprepo.go:415`) на такую строку не сработает: ошибки нет вовсе, есть
неправильные данные.

## Кто уже защитился, а кто ещё нет

Фронтовый клиент (`web-client/src/core/hooks/useChatInfoCard.ts`, задача 1.5
профиля на Solid) уже поставил гейт: зовёт `groups.card()` только под условием
`!isUser(peerId)` — то есть заведомо не ходит за карточкой ЧАТА для
приватного диалога, и достаёт «полного пользователя» другим путём
(`stores/fullPeers.solid.ts::requestFullPeer` → `privacy.profile()`). Это
защита ОДНОГО известного сегодня потребителя, а не источника: любой НОВЫЙ
клиент (другая платформа, скрипт, будущий фронтовый код, который забудет
про этот гейт) наступит на те же грабли — ручка продолжит молча врать.

## Что делать

Один из двух:

1. **Фильтр по типу в запросе** — `WHERE c.id=$1 AND c.type <> 'private'`
   (или явный список разрешённых типов) в `GroupRepo.Card`, с `pgx.ErrNoRows`
   → `domain.ErrNotFound` тем же путём, что и сегодня.
2. **Ранняя проверка до похода в БД** — в `GroupHandler.Card` (или в
   `Interactor.ChatCard`) отдельным дешёвым запросом/веткой резолвинга peerID
   отличить «это ключ пользователя» от «это ключ чата» ДО вызова `Card`, и
   отвечать `400`/`404`, если ключ спереди позитивный.

Второй вариант ближе к тому, как уже устроен `peerChatID`/`resolvePeer` (он
и так знает знак ключа при резолве) — вероятно, дешевле реализовать там же,
не трогая SQL `Card`.

## Критерий готовности

Запрос карточки чата (`GET /chats/{id}/card`) для позитивного id, за которым
стоит приватный диалог, отвечает ошибкой (`400` или `404`, не `200` с пустой
`channelFull`), и на это есть тест в
`internal/usecase/chat/group_test.go` (или интеграционный тест хендлера),
воспроизводящий сценарий «позитивный id, диалог существует, карточки чата
не существует».
