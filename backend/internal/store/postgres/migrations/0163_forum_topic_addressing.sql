-- +goose Up
-- Повторяемая: индекс — IF NOT EXISTS, перенос мьюта — только пока есть
-- старая колонка.
--
-- Ф-5, БЭК-1. Мьют темы — СРОК (peerNotifySettings.mute_until у
-- notifyForumTopic, tweb appMessagesManager.ts:11962-11981), а не булево:
-- «заглушить на час» обязано кончиться через час. Колонка muted_until есть с
-- 0058 и не писалась; булево muted переносится в неё («навсегда» — максимум
-- int32, domain.MuteUntilForever) и удаляется — второго способа сказать то же
-- самое не остаётся.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'topic_user_state' AND column_name = 'muted') THEN
        UPDATE topic_user_state
           SET muted_until = CASE WHEN muted THEN to_timestamp(2147483647) END;
        ALTER TABLE topic_user_state DROP COLUMN muted;
    END IF;
END $$;
-- +goose StatementEnd

-- Тема адресуется номером своей служебки создания: граница вывода сообщений
-- спрашивает пачкой «корни каких тредов — темы форума» (флаг forum_topic у
-- messageReplyHeader), выборка General отсекает служебки создания тем.
CREATE INDEX IF NOT EXISTS forum_topics_root_idx ON forum_topics (root_msg_id);

-- +goose Down
DROP INDEX IF EXISTS forum_topics_root_idx;
ALTER TABLE topic_user_state ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;
UPDATE topic_user_state SET muted = (muted_until IS NOT NULL AND muted_until > now());
