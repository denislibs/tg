-- +goose Up
-- A4-18: user_state.date — дата состояния апдейтов (updates.state.date схемы),
-- СЕКУНДЫ. Журнал прежде писал миллисекунды; переводим уже записанное.
-- Идемпотентно: секундная дата (< 10^11) условию не отвечает.
UPDATE user_state SET date = date / 1000 WHERE date > 100000000000;

-- +goose Down
SELECT 1;
