-- +goose Up
-- Гранулярные per-chat уведомления (tweb PeerNotifySettings): показ превью текста
-- и звук уведомления на уровне отдельного чата. NULL = наследовать от типа
-- (getPeerLocalSettings: per-peer поле поверх type-настроек). notify_sound —
-- 'default' | 'none' ('none' = беззвучно, без полного mute).
ALTER TABLE chat_members ADD COLUMN notify_preview BOOLEAN;
ALTER TABLE chat_members ADD COLUMN notify_sound TEXT;

-- +goose Down
ALTER TABLE chat_members DROP COLUMN notify_preview;
ALTER TABLE chat_members DROP COLUMN notify_sound;
