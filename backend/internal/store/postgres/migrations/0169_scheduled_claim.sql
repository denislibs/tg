-- +goose Up
-- Отложенные: аренда публикации и счётчики (Ф-5, S1, ревью).
--
-- claimed_until — строку публикует воркер или send_now: пока аренда не
--                 истекла, правка и снятие её не трогают, второй публикатор
--                 её не берёт (без аренды публикация, правка и снятие гонялись:
--                 призрачные кадры, потерянные правки). Истёкшая аренда после
--                 сбоя — отступ до следующей попытки.
-- attempts      — попыток публикации текущего срока; после предела строка
--                 снимается как отвергнутая (иначе «вечные» строки занимали бы
--                 окно Due и голодала бы вся очередь).
-- occurrence    — сколько сроков повтора уже опубликовано: первое вхождение
--                 оплачено при постановке, каждое следующее платит при
--                 публикации.
ALTER TABLE scheduled_messages
    ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempts      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS occurrence    INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE scheduled_messages
    DROP COLUMN IF EXISTS occurrence,
    DROP COLUMN IF EXISTS attempts,
    DROP COLUMN IF EXISTS claimed_until;
