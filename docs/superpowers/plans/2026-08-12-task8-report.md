# Task 8 — stripped-превью до tweb-уровня (бэкенд): отчёт

Ветка: `feat/tweb-media-core`. Референс: tweb `src/helpers/bytes/getPreviewURLFromBytes.ts`
(формат stripped: тело после стандартного JPEG-заголовка, байты [1],[2] — высота/ширина,
максимальная сторона ~40px).

## 1. Аудит текущей генерации blurPreview

Главная находка аудита: **blurPreview фактически не генерировался вообще.**

- Колонка `media.blur_preview` (с 0004_media.sql) заполнялась только из тела
  `POST /media/upload` (`uploadBody.BlurPreview`) — т.е. предполагался клиентский LQIP.
- Фронт его **не отправляет** (и не отправлял): `web-client/src/core/media/scaleImageForSend.ts`
  прямо говорит «Клиентский thumb/blur тут НЕ генерим — это делает бэкенд (ffmpeg)».
- ffmpeg-процессор (`backend/internal/adapter/media/ffmpeg/processor.go`) при этом генерировал
  только большой thumb/poster (**1280px, -q:v 3**, уезжает в MinIO как `thumb_key`) — к
  blur_preview он отношения не имел.

Итог «до»: blur_preview = 0 байт у всех загрузок (пустая строка/NULL), фронт всегда падал в
фолбэк. Размер «до» в терминах превью — **нет превью**; ближайший родственник (thumb) —
1280px, десятки КБ, но это не LQIP и в payload он не ездил.

## 2. Что сделано «после»

### Генерация stripped на сервере (для ВСЕХ визуальных медиа)

`ffmpeg/processor.go`: второй проход ffmpeg на том же кадре —
`strippedMaxSide = 40`, `strippedQuality = 28` (mjpeg `-q:v 28` ≈ libjpeg q≈20:
именно q≈20 соответствует DQT-таблица телеграмного stripped-заголовка из tweb
`getPreviewURLFromBytes.ts`). Без апскейла, аспект сохраняется.

Замер на реальном ffmpeg (контейнер msgrverify-backend, вход 1280×960 → выход 40×30):

| источник | -q:v | байт (полный JPEG) |
|---|---|---|
| testsrc2 | 20 | 528 |
| testsrc2 | 28 | **481** |
| testsrc2 | 31 | 461 |
| mandelbrot (высокочастотный) | 28 | **417** |

Это байтовый уровень tweb: у Telegram тело stripped ~200–400 байт + восстановленный
клиентом заголовок 623 байта ≈ 0.8–1.0 КБ полного JPEG; у нас 0.4–0.6 КБ полного JPEG.

**Осознанное отступление от tweb (задокументировано у `domain.Media.BlurPreview`):**
формат остаётся «полный base64 JPEG в JSON» — у нас транспорт JSON, а не TL, поэтому
байтоэкономия с обрезкой заголовка и восстановлением его на клиенте не нужна.

Конвейер: `ProcessResult.Stripped` → фоновый `process()` → `ProcessedMeta.BlurPreview`
→ `media.blur_preview` (`UpdateProcessed`, пустое значение не затирает записанное).
Клиентское поле `blur_preview` из тела аплоада удалено как мёртвое
(`uploadBody`, `UploadInput`, INSERT в `mediarepo.Create`).

### Stripped-превью аватарок пиров (`avatar_preview`)

Генерация — при установке/смене аватарки: новый метод
`media.Interactor.StrippedPreview(ctx, mediaID)` (вернуть из строки; если фоновая
обработка ещё не записала — сгенерировать синхронно тем же процессингом и сохранить),
проброшен в auth usecase опциональным портом `AvatarPreviewer`
(`SetAvatarPreviewer`, wiring в `app/server.go` при поднятом MinIO). Деградация мягкая:
без превьюера/процессора аватарка ставится без превью.

Покрытые пути установки: `PUT /me/avatar`, `POST /me/photos` и приём «предложенного фото»
(chat usecase → `ProfilePhotoAdder`, сигнатура порта не менялась — превью резолвится внутри
auth usecase по content-пути `/media/{id}/content`).

## 3. Миграция

`backend/internal/store/postgres/migrations/0091_avatar_previews.sql`:

```sql
ALTER TABLE users          ADD COLUMN avatar_preview BYTEA;  -- nullable, БЕЗ бэкфилла
ALTER TABLE profile_photos ADD COLUMN preview        BYTEA;  -- для отката при удалении текущей аватарки
```

Nullable намеренно: существующие аватарки не пересчитываются (дорого), у них превью NULL —
фронт фолбэкает на градиент (комментарий в миграции). Превью фото **групп/каналов** отдельной
колонки не требует: `chats.photo_media_id` ссылается на media — `blur_preview` берётся джойном.

## 4. Слои прокладки

- **domain**: `User.AvatarPreview`, `UserCard.AvatarPreview`, `DialogPeer.AvatarPreview`,
  `Contact.AvatarPreview`, `UserProfile.AvatarPreview`, `Dialog.PhotoPreview`,
  комментарий у `Media.BlurPreview`.
- **usecase**: `auth` (порт `AvatarPreviewer`, `SetAvatar`/`AddProfilePhoto`,
  сигнатура `UserRepo.AddProfilePhoto` +preview; мёртвый `UserRepo.SetAvatar` удалён);
  `media` (`StrippedPreview`, `ProcessResult.Stripped`, `ProcessedMeta.BlurPreview`);
  `chat` (privacy-фильтр и личное фото контакта гасят `AvatarPreview` вместе с URL);
  `privacy` (`Profile` отдаёт превью под тем же правилом profile_photo, что и avatar_url).
- **adapter/repo/postgres**: `authrepo` (userCols/scanUser/SessionByTokenHash/SoftDelete/
  AddProfilePhoto/DeleteProfilePhoto — откат превью к следующему фото галереи),
  `chatsrepo` (диалоги: `peer.avatar_preview` + `photo_preview` через `LEFT JOIN media`),
  `contactsrepo`, `grouprepo.UsersByIDs`, `privacyrepo.GetUser`, `mediarepo`
  (Create без blur_preview; UpdateProcessed пишет его с защитой от затирания).
- **adapter/delivery/http** (новое поле `avatar_preview`, base64 через штатный маршалинг
  `[]byte`): `GET/PUT /me*` (userJSON), `GET /chats` (peer.avatar_preview + photo_preview),
  `GET /contacts`, `GET /users` (гасится вместе со скрытым privacy аватаром),
  `GET /users/{id}`.
- **WS-кадры**: карточки пиров по WS не ездят — `user_update` намеренно несёт только
  `avatar_changed` (privacy-гейт на refetch, см. док-коммент `emitUserUpdate`); менять нечего.

Непроложенные второстепенные поверхности (поле nullable, фронт фолбэкает на градиент, как и
для старых аватарок): списки участников каналов, выдача поиска (search/public), stories
(автор/зрители), списки реакций, чёрный список, аватары ботов (`botapirepo.SetAvatar` —
комментарий на месте), личные фото контактов (`CustomPhotoMap`). При надобности — тем же
приёмом (join `users.avatar_preview` / `media.blur_preview`).

## 5. Тесты

Новые/обновлённые:

- `usecase/media/media_test.go`: `TestProcess_PersistsStripped` (stripped доезжает до
  репозитория из фоновой обработки), `TestStrippedPreview` (из строки без обращения к
  хранилищу / синхронная генерация с персистом / nil-процессор → nil без ошибки).
- `usecase/auth/profile_test.go`: `TestSetAvatarStrippedPreview` (превью запрошено по
  верному media_id и легло в профиль; без превьюера — прежнее поведение).
- `adapter/delivery/http/profile_handler_test.go`: `TestSetAvatarPreview_HTTP`
  (`avatar_preview` base64 в ответе PUT /me/avatar и GET /me) + проверка
  `"avatar_preview":null` без превьюера (старые аватарки не ломают ответ).
- `adapter/repo/postgres/mediarepo_test.go`: `TestMediaRepo_BlurPreviewProcessed`
  (UpdateProcessed пишет; пустое превью не затирает; Create оставляет NULL).
- `adapter/repo/postgres/authrepo_test.go`: галерея — превью денормализуется в
  users.avatar_preview, откатывается к превью предыдущего фото при удалении текущего,
  чистится при удалении последнего.

Прогон: `go build ./... && go vet ./...` — чисто; `go test ./...` (интеграционные на
testcontainers, Docker поднят) — все пакеты зелёные, кроме
`internal/adapter/delivery/ws` (`TestWS_RevokeClosesSocket`, «send on closed channel» в
`ws.hub.route`): падение воспроизводится и на чистом базовом коммите без правок Task 8 —
préexisting-проблема ветки/окружения, к этой задаче отношения не имеет.
