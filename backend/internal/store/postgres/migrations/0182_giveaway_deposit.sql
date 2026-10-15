-- +goose Up
-- Вклад создателя звёздного розыгрыша (stars × winners_count), списанный при
-- создании. Призы и возврат неразданных мест считаются из него, а не из
-- параметров розыгрыша: так выплата не превышает внесённое.
ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS deposit BIGINT NOT NULL DEFAULT 0;

-- Розыгрыши звёзд, созданные до введения вклада (deposit = 0), ничем не
-- обеспечены: закрываем без выплат, иначе при завершении призы появились бы из
-- воздуха. Повторный запуск безопасен: у новых розыгрышей deposit > 0.
UPDATE giveaways SET status = 'finished', winner_ids = '[]'
 WHERE status = 'active' AND prize_kind = 'stars' AND deposit = 0;

-- +goose Down
ALTER TABLE giveaways DROP COLUMN IF EXISTS deposit;
