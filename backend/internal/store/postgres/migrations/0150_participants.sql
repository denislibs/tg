-- +goose Up
-- Участники в форме оригинала (Б-115, Б-117): ранг админа, кто привёл
-- участника, вступил ли он по заявке. promoted_by уже есть (0139).
--   rank        — channelParticipantAdmin/Creator.rank (пользовательская подпись);
--   inviter_id  — channelParticipantSelf/Admin.inviter_id: кто добавил или чья
--                 ссылка; NULL — вступил сам по @имени или создатель;
--   via_request — channelParticipantSelf.via_request: вошёл одобренной заявкой.
-- Повторяемая: IF NOT EXISTS у колонок и индексов.
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS inviter_id BIGINT;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS via_request BOOLEAN NOT NULL DEFAULT false;

-- Админы до 0139 остались без назначившего, а channelParticipantAdmin.promoted_by
-- обязателен: клиент (tweb canEditAdmin) по пустому считал админа правимым
-- любым, кто вправе назначать, и сервер отвечал 403 (п. 5 ревью #401).
-- Сервер и так даёт их править только владельцу — вписываем его явно.
UPDATE chat_members cm SET promoted_by = c.creator_id
  FROM chats c
 WHERE c.id = cm.chat_id AND cm.role = 'admin' AND cm.promoted_by IS NULL AND c.creator_id IS NOT NULL;

-- Фильтры channels.getParticipants: «недавние» — по дате вступления, админы —
-- частичный индекс (их единицы на чат), выгнанные/ограниченные/заявки — по дате.
CREATE INDEX IF NOT EXISTS idx_chat_members_chat_joined ON chat_members (chat_id, joined_at DESC, user_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_chat_staff ON chat_members (chat_id) WHERE role IN ('creator', 'admin');
CREATE INDEX IF NOT EXISTS idx_chat_bans_chat_date ON chat_bans (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_restrictions_chat_date ON chat_restrictions (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_join_requests_chat_date ON join_requests (chat_id, created_at DESC, user_id);

-- +goose Down
DROP INDEX IF EXISTS idx_join_requests_chat_date;
DROP INDEX IF EXISTS idx_chat_restrictions_chat_date;
DROP INDEX IF EXISTS idx_chat_bans_chat_date;
DROP INDEX IF EXISTS idx_chat_members_chat_staff;
DROP INDEX IF EXISTS idx_chat_members_chat_joined;
ALTER TABLE chat_members DROP COLUMN IF EXISTS via_request;
ALTER TABLE chat_members DROP COLUMN IF EXISTS inviter_id;
ALTER TABLE chat_members DROP COLUMN IF EXISTS rank;
