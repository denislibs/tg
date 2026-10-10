-- +goose Up
-- pts журнала broadcast-канала есть с создания — 1, как у оригинала: клиент
-- (tweb apiUpdatesManager.addChannelState) заводит состояние канала только из
-- известного pts (dialog.pts, messages.channelMessages.pts) и без него
-- отбрасывает живой пост как «уже учтённый». Каналы без единой записи журнала
-- получают 1; дальше счётчик растёт как прежде (channel_pts + 1).
UPDATE chats SET channel_pts = 1 WHERE type = 'channel' AND channel_pts = 0;

-- +goose Down
UPDATE chats c SET channel_pts = 0
 WHERE c.type = 'channel' AND c.channel_pts = 1
   AND NOT EXISTS (SELECT 1 FROM channel_updates u WHERE u.channel_id = c.id);
