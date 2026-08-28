-- +goose Up
-- animated — «медиа проигрывается как гифка»: аналог telegram-атрибута
-- documentAttributeAnimated (layer.d.ts), из которого tweb выводит doc.type ===
-- 'gif' (appDocsManager.ts:219-226). Вычисляется фоновой обработкой:
-- настоящий image/gif либо видео БЕЗ аудиодорожки (telegram-семантика
-- nosound_video — именно так там классифицируются гифки).
--
-- Гифка в ленте рисуется иначе, чем видео: бейдж «GIF» вместо таймкода,
-- без кнопки play, зацикленный автоплей (tweb video.ts:120-123, :164-171).
-- Без этого признака клиент вынужден гадать по имени файла и длительности
-- (web-client/src/core/gifs.ts) — что и было до появления колонки.
--
-- DEFAULT FALSE для уже загруженных строк: «обычное видео» — безопасный
-- (и для подавляющего большинства верный) исход; повторная обработка старого
-- медиа проставит признак корректно.
ALTER TABLE media ADD COLUMN animated BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE media DROP COLUMN animated;
