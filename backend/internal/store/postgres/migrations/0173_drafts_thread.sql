-- +goose Up
-- Повторяемая: колонка — IF NOT EXISTS, ключ пересобирается только пока он
-- старый (две колонки).
--
-- Ф-5, БЭК-2 (A3-32). Черновик — на пару «пир + тред», а не на чат: у tweb
-- ключ черновика `peerId_threadId` (appDraftsManager.ts:88-90), апдейт
-- updateDraftMessage несёт top_msg_id. thread_root_id — ключ строки корня
-- треда (как topic_user_state.root_msg_id): 0 — без треда; в форуме 0 —
-- General (у неё строки корня нет), наружу едет top_msg_id = 1.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS thread_root_id BIGINT NOT NULL DEFAULT 0;

-- +goose StatementBegin
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.key_column_usage k
          JOIN information_schema.table_constraints c
            ON c.constraint_name = k.constraint_name AND c.table_schema = k.table_schema
         WHERE c.table_schema = current_schema() AND c.table_name = 'drafts'
           AND c.constraint_type = 'PRIMARY KEY') = 2 THEN
        ALTER TABLE drafts DROP CONSTRAINT drafts_pkey;
        ALTER TABLE drafts ADD CONSTRAINT drafts_pkey PRIMARY KEY (chat_id, user_id, thread_root_id);
    END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
-- Обратно один черновик на чат: черновики тредов удаляются — старой схеме их
-- некуда положить.
DELETE FROM drafts WHERE thread_root_id <> 0;
ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_pkey;
ALTER TABLE drafts ADD CONSTRAINT drafts_pkey PRIMARY KEY (chat_id, user_id);
ALTER TABLE drafts DROP COLUMN IF EXISTS thread_root_id;
