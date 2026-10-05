-- +goose Up
-- Роль вступающего — по ТИПУ чата (domain.JoinRole): в канал вступает
-- подписчик, в группу — обычный участник. Прежде каждый путь ставил роль сам:
-- по ссылке, добавлением и одобрением заявки в КАНАЛ входили 'member' (и
-- получали дефолтные права группы — переименовать канал, закрепить пост), а по
-- @имени в ГРУППУ — 'subscriber' (и не могли закрепить даже при открытых
-- дефолтных правах). Снятый админ канала тоже становился 'member'.
UPDATE chat_members cm SET role = 'subscriber'
  FROM chats c
 WHERE c.id = cm.chat_id AND c.type = 'channel' AND cm.role = 'member';
UPDATE chat_members cm SET role = 'member'
  FROM chats c
 WHERE c.id = cm.chat_id AND c.type = 'group' AND cm.role = 'subscriber';

-- Кто назначил админа (channelParticipantAdmin.promoted_by): чужого админа
-- правит только владелец или назначивший (tweb canEditAdmin). У админов,
-- назначенных до этой миграции, назначивший неизвестен — NULL, и править их
-- может только владелец.
ALTER TABLE chat_members ADD COLUMN promoted_by BIGINT;

-- Новые биты прав админа: anonymous (1<<8) и manage_topics (1<<9). Создатель
-- хранит полный набор (domain.AllRights) — он уезжает ему в admin_rights.
UPDATE chat_members SET rights = 1023 WHERE role = 'creator';

-- +goose Down
-- Роли назад не переводятся: прежнее распределение (member у вступивших в
-- канал по ссылке, subscriber — по @имени) было ошибкой, восстанавливать нечего.
UPDATE chat_members SET rights = rights & 255;
ALTER TABLE chat_members DROP COLUMN promoted_by;
