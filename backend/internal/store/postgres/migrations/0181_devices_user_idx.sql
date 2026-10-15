-- +goose NO TRANSACTION
-- +goose Up
-- idx_devices_user: devices ходят по user_id (ListByUser, CountByUser на горячем
-- пути входа, DeleteOthers/DeleteAll), а индексов кроме pkey и token_hash не
-- было — Seq Scan. CONCURRENTLY: без SHARE-замка, иначе на время построения
-- блокируются вход и UPDATE last_active (прецеденты 0142, 0162, 0164).
-- Прерванное построение оставляет индекс с indisvalid = false, а IF NOT EXISTS его
-- не перестроит: после миграции проверить
--   SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_devices_user'::regclass;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_devices_user ON devices (user_id);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_devices_user;
