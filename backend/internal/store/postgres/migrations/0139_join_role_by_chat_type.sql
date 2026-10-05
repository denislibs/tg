-- +goose Up
-- Повторяемая: на БД стендов, где эта же миграция уже лежала под номером
-- 0137 (до влития 0138), накат проходит ещё раз без ошибки — колонка с
-- IF NOT EXISTS, все UPDATE дают тот же результат при повторе.

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
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS promoted_by BIGINT;

-- Новые биты прав админа: anonymous (1<<8) и manage_topics (1<<9). Создатель
-- хранит полный набор (domain.AllRights) — он уезжает ему в admin_rights.
UPDATE chat_members SET rights = 1023 WHERE role = 'creator';
-- Темами прежде управлял любой админ группы — бит manage_topics выдаётся всем
-- текущим админам групп, чтобы они не потеряли это право разом. anonymous
-- («писать от имени группы») НЕ выдаётся: раздача его любому админу и была
-- находкой A5-37, у Telegram он по умолчанию выключен.
UPDATE chat_members cm SET rights = cm.rights | 512
  FROM chats c
 WHERE c.id = cm.chat_id AND c.type = 'group' AND cm.role = 'admin';

-- У группы обсуждения канала история видна всегда (Telegram при привязке
-- открывает её, tweb setDiscussionGroup → togglePreHistoryHidden(false);
-- скрыть потом нельзя — CHAT_LINK_EXISTS). Иначе подписчик, вступивший
-- первым комментарием, теряет все прежние комментарии.
UPDATE chats SET history_for_new = true
 WHERE id IN (SELECT discussion_chat_id FROM chats WHERE discussion_chat_id IS NOT NULL);

-- +goose Down
-- Роли, бит manage_topics и открытая история назад не переводятся: прежнее
-- состояние было ошибкой, восстанавливать нечего.
UPDATE chat_members SET rights = rights & 255;
ALTER TABLE chat_members DROP COLUMN IF EXISTS promoted_by;
