-- +goose Up
-- Курсор заявок (messages.getChatInviteImporters offset_date) — секунды, а
-- сравнение шло по микросекундам: заявка 10:00:00.300 после строки
-- 10:00:00.700 не проходила (created_at, user_id) < (10:00:00, …) и терялась
-- при листании (ревью #404 п. 6). Дата заявки хранится с точностью провода.
-- Повторяемая: усечение идемпотентно.
UPDATE join_requests SET created_at = date_trunc('second', created_at)
 WHERE created_at <> date_trunc('second', created_at);
ALTER TABLE join_requests ALTER COLUMN created_at SET DEFAULT date_trunc('second', now());

-- +goose Down
ALTER TABLE join_requests ALTER COLUMN created_at SET DEFAULT now();
