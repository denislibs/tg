-- +goose Up
-- «Проверка фактов» на сообщении (Telegram factCheck): пояснение админа/модератора
-- (у нас — автора/админа канала) к посту. Хранится одним jsonb-полем на строке
-- сообщения: {text, entities, country}. NULL — проверки нет. Пишется/снимается
-- отдельным UPDATE (см. messages_repo.SetFactCheck), в INSERT не участвует.
ALTER TABLE messages ADD COLUMN factcheck JSONB;

-- +goose Down
ALTER TABLE messages DROP COLUMN factcheck;
