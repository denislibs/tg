-- +goose Up
-- Кадр карточки пользователя стал конструктором updateUserSnapshot.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р4). В схеме на этом месте
-- updateUser{user_id}: кадр говорит «перечитай карточку», а сама карточка едет
-- рядом — вектором `users` КОНТЕЙНЕРА updates. Контейнера у нас пока нет, а
-- отдать один id значило бы получить шторм запросов карточки (дедупликации
-- запросов, которая у оригинала стоит в appUsersManager, у нас тоже нет).
-- Поэтому объявлен СВОЙ конструктор с явным id — тем же решением, что уже
-- принято по chat_update.
--
-- Замороженное тело было САМОЙ карточкой (конструктор `user` верхним уровнем),
-- то есть кадр и его предмет были одним объектом. Теперь предмет лежит внутри
-- кадра, как у всех остальных.

UPDATE updates SET payload = jsonb_build_object('_', 'updateUserSnapshot', 'user', payload)
 WHERE type = 'user_update'
   AND payload IS NOT NULL
   AND payload->>'_' = 'user';

-- +goose Down
-- Обратный ход возвращает карточку верхним уровнем.

UPDATE updates SET payload = payload->'user'
 WHERE type = 'user_update'
   AND payload->>'_' = 'updateUserSnapshot';
