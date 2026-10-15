-- +goose Up
-- Ф7-З (MC-10). Позиция «Все чаты» среди папок пользователя: число папок,
-- стоящих перед ней в порядке `messages.updateDialogFiltersOrder` (0 — первой).
-- «Все чаты» — не строка таблицы folders (id 0 у клиента), поэтому её место
-- хранится у владельца (решение В-6): премиум переставляет её среди папок
-- (tweb chatFolders.tsx:108-110, :200-203).
ALTER TABLE users ADD COLUMN IF NOT EXISTS dialog_filters_all_pos INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS dialog_filters_all_pos;
