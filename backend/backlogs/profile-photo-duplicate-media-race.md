# Дубль media_id в галерее фото профиля при повторе `POST /me/photos`

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** 2026-09-05 (`fix/profile-photo-delete-id`); 2026-10-13 (Ф7-А2) — снят второй вызывающий,
ручка принятия предложенного фото и её гонка; остаётся повтор своей загрузки.

## Что происходит

В `profile_photos` нет `UNIQUE(user_id, media_id)` (`0042_profile_photos.sql`, `0103_peer_model_tl.sql`),
а `AddProfilePhoto` (`adapter/repo/postgres/authrepo.go`) — обычный `INSERT` без `ON CONFLICT`.

Повтор `POST /me/photos` с тем же `media_id` (двойной тап, повтор запроса после сетевого сбоя, два устройства):
`ownedMedia` пропускает свой файл, `SquareAvatar` для квадратного файла возвращает тот же id — второй `INSERT`
создаёт дубль строки.

## Последствие

`DELETE /me/photos/{mediaID}` удаляет по `media_id` (`DELETE … WHERE media_id=$1 AND user_id=$2`) и сносит обе
строки разом. Тяжесть низкая: строки неотличимы, `users.avatar_media_id` от дублей не зависит.

## Что делать

1. Миграция: `ALTER TABLE profile_photos ADD CONSTRAINT profile_photos_user_media_uniq UNIQUE (user_id, media_id)`
   (перед ней — дедупликация существующих строк).
2. `AddProfilePhoto` — `INSERT … ON CONFLICT (user_id, media_id) DO NOTHING`, конфликт обработать явно, не ошибкой.

**Критерий готовности:** два последовательных и два конкурентных `POST /me/photos` с одним `media_id` дают
ровно одну строку в `profile_photos`; тест поверх реальной БД.
