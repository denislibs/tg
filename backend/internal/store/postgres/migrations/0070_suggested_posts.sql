-- +goose Up
-- Предложка постов в каналах (Telegram suggested posts): участник без права
-- постинга предлагает пост, админ канала одобряет (публикует сразу или к
-- назначенному времени) либо отклоняет. Хранится отдельной таблицей; ссылок на
-- messages нет — одобренный пост публикуется обычным каналным сообщением.
CREATE TABLE suggested_posts (
    id         BIGSERIAL PRIMARY KEY,
    chat_id    BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    author_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL DEFAULT '',
    entities   JSONB,
    media_id   BIGINT,
    publish_at TIMESTAMPTZ,                      -- желаемое/назначенное время публикации (NULL — как можно скорее)
    status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by BIGINT,
    decided_at TIMESTAMPTZ
);

CREATE INDEX suggested_posts_chat_status_idx ON suggested_posts (chat_id, status);
CREATE INDEX suggested_posts_author_idx ON suggested_posts (chat_id, author_id);
-- скан воркера отложенной публикации: одобренные посты с наступившим временем
CREATE INDEX suggested_posts_due_idx ON suggested_posts (publish_at)
    WHERE status = 'approved' AND publish_at IS NOT NULL;

-- +goose Down
DROP TABLE suggested_posts;
