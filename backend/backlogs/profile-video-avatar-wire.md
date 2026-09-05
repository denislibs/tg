# Видео-аватарка теряется на проводе, не в клиенте

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** волна 3 «Solid-миграция» (фронт), программа
`docs/superpowers/plans/2026-09-05-profile-avatars-class.md`, задача 2
(данные и лента `PeerProfileAvatars`), названо задачей 6 — 2026-09-05.
**Место в репозитории:** этот файл — первый в `backend/backlogs/` (аналог
`web-client/backlogs/frontend/`, см. примечание в конце). В репозитории на
момент фиксации нет отдельного «бэклога бэкенда» — `docs/readiness/` держит
матрицы готовности (сущности/действия) и `port-divergences.md` (расхождения
ФРОНТЕНДА с tweb), а не список открытых бэкендовых задач; ни то, ни другое
не подходящее место для конкретной, адресной недоделки одной ручки.

## Что происходит

В БД поле для видео-аватарки ЕСТЬ: `domain.ProfilePhoto.VideoMediaID
*int64` (`internal/domain/user.go:98-104`). На клиенте ветка отрисовки видео
УЖЕ ПОРТИРОВАНА и покрыта тестом на прямой фикстуре
(`web-client/src/components/peerProfileAvatars.ts::processItem`, ветка
`photo.videoMediaId`) — она ждёт от бэкенда числовое `videoMediaId` в теле
галереи, и оживёт БЕЗ переделки клиента, как только провод почитают.

Разрыв — ровно между БД и HTTP-ответом:

1. `galleryPhoto()` (`internal/adapter/delivery/http/profile_handler.go:404
   -406`) строит `domain.Photo` через `domain.NewPhoto(p.MediaID, []domain.
   PhotoSize{})` — параметр `p.VideoMediaID` конструктора игнорируется
   целиком, в возвращаемом объекте для него нет даже поля.
2. Сам `domain.Photo` (`internal/domain/mtmedia.go:124-134`) не несёт
   `video_sizes` вовсе:

   ```go
   // photo#fb197a65 flags:# has_stickers:flags.0?true id:long access_hash:long
   // file_reference:bytes date:int sizes:Vector<PhotoSize>
   // video_sizes:flags.1?Vector<VideoSize> dc_id:int = Photo;
   type Photo struct {
       Underscore string      `json:"_"`
       ID         int64       `json:"id"`
       Sizes      []PhotoSize `json:"sizes"`
   }
   ```

   Комментарий над структурой уже цитирует полную TL-схему конструктора
   (включая `video_sizes:flags.1?Vector<VideoSize>`), но поле `Sizes` —
   единственное, что реализовано; `VideoSize` как тип в домене НЕ СУЩЕСТВУЕТ
   вовсе (грепом по `internal/domain/*.go` — только упоминания в
   TL-комментариях, `mtmedia.go:128,228`).
3. Клиентский `mapProfilePhoto` (`web-client/src/core/managers/
   profileManager.ts:143`) поэтому жёстко пишет `videoMediaId: undefined` —
   не потому что клиент решил игнорировать поле, а потому что ответ сервера
   физически не несёт его ни в каком виде.

## Эффект сегодня

Пользователь с видео-аватаркой (короткий зацикленный ролик вместо статичной
фотографии — Telegram-фича) видит в карусели профиля ОБЫЧНОЕ статичное фото
вместо играющего видео на этом месте галереи. Сам факт «у этого фото есть
видео-вариант» присутствует в БД и теряется целиком при сериализации в
HTTP-ответ.

## Что делать

1. Завести `domain.VideoSize` (TL `videoSize#e831c556 flags:#
   type:string w:int h:int size:int video_start_ts:flags.0?double =
   VideoSize;` — минимальный набор полей под наш случай: ссылка на
   медиа-файл видео-варианта, а не полноценный TL-конструктор один в один,
   если он нам не нужен целиком).
2. `domain.Photo` — добавить `VideoSizes []VideoSize`, `NewPhoto` — принять
   их опционально (или завести `NewPhotoWithVideo`, если менять сигнатуру
   существующего конструктора нежелательно из-за других вызывающих —
   проверить грепом `domain.NewPhoto(`).
3. `galleryPhoto()` (`profile_handler.go:404`) — если `p.VideoMediaID != nil`,
   собрать `VideoSize` (тем же `MediaID`, каким сегодня адресуется превью
   истории — см. `web-client/CLAUDE.md` § «Медиа-слой», `resolveStreamUrl`
   на клиенте ждёт числовой id медиа, не готовый URL) и положить в
   `video_sizes`.
4. Свериться с клиентским потребителем ПЕРЕД сдачей: `web-client/src/
   components/peerProfileAvatars.ts::processItem`, ветка `photo.videoMediaId`
   — она уже ждёт именно числовой id (`resolveStreamUrl(photo.videoMediaId)`)
   и покрыта тестом на прямой фикстуре; менять клиент не требуется, только
   провод.

**Критерий готовности:** `GET /users/{id}/photos` для пользователя с
видео-аватаркой отдаёт `video_media_id` (или эквивалентное поле, из
которого клиентский `mapProfilePhoto` соберёт `videoMediaId`) в теле фото
галереи; интеграционный тест на `profile_handler_test.go` заводит фото с
непустым `VideoMediaID` и проверяет непустой `video_sizes`/аналог в JSON-
ответе; на фронте существующий тест `peerProfileAvatars.test.ts` (ветка
видео) продолжает быть зелёным без изменений своего кода — только смена
источника фикстуры на реальный формат ответа подтверждает совместимость.

---

**Примечание координатору:** отдельного «бэклога бэкенда» (аналога
`web-client/backlogs/frontend/`) в репозитории на момент фиксации не было —
заведена директория `backend/backlogs/` с этим файлом первым. Если позже
появится более подходящее общее место (например, секция в
`docs/readiness/`), стоит решить, куда переносить: важно не размножать два
параллельных списка открытых бэкендовых задач.
