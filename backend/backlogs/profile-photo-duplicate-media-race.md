# Дубль media_id в галерее фото профиля возможен из-за гонки в принятии предложенной аватарки

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** ветка `fix/profile-photo-delete-id`, при правке
`DELETE /me/photos/{mediaID}` на адресацию по id медиа — 2026-09-05.

## Что происходит

В `profile_photos` нет `UNIQUE(user_id, media_id)`: миграция
`0042_profile_photos.sql` заводит таблицу без такого ограничения, а
`0103_peer_model_tl.sql` (переезд колонки `url` → `media_id`) его тоже не
добавляет — `media_id BIGINT NOT NULL`, и только.

`AddProfilePhoto` (`internal/adapter/repo/postgres/authrepo.go:259-279`) —
обычный `INSERT INTO profile_photos (...) VALUES (...)` без `ON CONFLICT`:
дедупликации на уровне запроса нет.

По обычному пути (`POST /me/photos`, `internal/usecase/auth/profile.go:258`)
дубль практически недостижим: каждая загрузка даёт новый `media_id`, второй
раз тот же id туда не попадёт.

Но есть второй вызывающий с гонкой — `AcceptProfilePhotoSuggestion`
(`internal/usecase/chat/contactphoto.go:40-91`):

1. Флаг `act.Accepted` читается в начале функции — сообщение достаётся
   через `i.msgs.GetByID` (строка 44), действие типизируется и проверяется
   на строке 55 (`if act.Accepted { return domain.ErrConflict }`).
2. `i.profilePics.AddProfilePhoto(...)` вызывается на строке 74 — это и есть
   вставка строки в `profile_photos`.
3. Флаг выставляется в `true` только на строке 81 и пишется в БД отдельной
   транзакцией через `i.tx.WithinTx` (строки 85-90, `i.msgs.UpdateAction`) —
   то есть ПОСЛЕ вставки фото, а не атомарно с проверкой на шаге 1.

Между чтением флага (шаг 1) и его записью (шаг 3) нет ни атомарного
`UPDATE ... WHERE accepted=false`, ни advisory-лока, ни какой-либо другой
блокировки. Два почти одновременных вызова `AcceptProfilePhotoSuggestion`
для одного и того же сообщения (двойной тап, два устройства одного
пользователя) оба успевают пройти проверку `act.Accepted == false` до того,
как первый успеет её сбросить, и оба вставляют строку в `profile_photos` с
одним и тем же `media_id`.

## Последствие для правки удаления по media_id

`DELETE FROM profile_photos WHERE media_id=$1 AND user_id=$2`
(`authrepo.go:318`, ветка `fix/profile-photo-delete-id`) удаляет ПО
`media_id`, а не по `id` строки. Если дубль всё же случился, такой DELETE
снесёт обе одинаковые строки разом одним вызовом ручки — пользователь,
ожидавший убрать один дубль, лишится обоих.

Тяжесть эффекта низкая: обе строки-дубликата указывают на одно и то же
медиа, в галерее визуально неотличимы (пользователь не может выбрать «вот
эту, а не ту» — они одинаковые), а пересчёт текущей аватарки в
`AddProfilePhoto`/`DeleteProfilePhoto` работает со скалярным
`users.avatar_media_id`, который от количества дублирующих строк в галерее
не зависит и не портится.

Риск существовал независимо от того, по какому полю адресуется удаление
(`id` строки или `media_id`) — при адресации по `id` строки дубль просто
не убрать вообще без второго вызова, при адресации по `media_id` он
убирается разом. Этой веткой (`fix/profile-photo-delete-id`) гонка не
введена и не усугублена — она предсуществующая, обнаружена по ходу
изучения `AddProfilePhoto`/`profile_photos` при работе над той правкой.

## Что делать

1. Миграция: `ALTER TABLE profile_photos ADD CONSTRAINT
   profile_photos_user_media_uniq UNIQUE (user_id, media_id)`.
2. `AddProfilePhoto` (`authrepo.go:259`) — `INSERT ... ON CONFLICT
   (user_id, media_id) DO NOTHING`, с проверкой, вставилась ли строка
   (`RETURNING` вернёт 0 строк при конфликте — обработать этот случай явно,
   не как ошибку).
3. Закрыть саму гонку в `AcceptProfilePhotoSuggestion`
   (`contactphoto.go:40-91`): проверку и выставление `act.Accepted`
   сделать атомарными — либо `UPDATE ... SET action=... WHERE id=$1 AND
   action->>'accepted' = 'false'` с проверкой числа задетых строк перед
   вызовом `AddProfilePhoto`, либо advisory-лок на `msgID` на время всей
   функции.

**Критерий готовности:** два одновременных вызова
`AcceptProfilePhotoSuggestion` для одного и того же предложения дают ровно
одну строку в `profile_photos` (второй вызов получает `domain.ErrConflict`,
как и сегодня для последовательных вызовов) — и на это есть тест с двумя
конкурентными горутинами/вызовами поверх реальной БД, воспроизводящий гонку
до фикса и падающий без него.
