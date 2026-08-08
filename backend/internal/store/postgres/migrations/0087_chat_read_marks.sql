-- +goose Up
-- История горизонта чтения: по строке на каждое ПРОДВИЖЕНИЕ last_read_seq.
-- Нужна для «Прочитано в HH:MM» у конкретного сообщения (Telegram
-- messages.getOutboxReadDate): в chat_members лежит только одна отметка
-- last_read_at на весь чат, поэтому без этой таблицы все сообщения показывали
-- одно и то же время. Дата для сообщения = read_at ближайшей сверху отметки
-- (минимальный up_to_seq >= seq сообщения).
--
-- Рост ограничен: MarkRead удаляет отметки старше 30 дней для той же пары
-- (chat_id, user_id) — читатели видят дату только у свежих сообщений, как в
-- Telegram, а таблица не растёт бесконечно.
CREATE TABLE IF NOT EXISTS chat_read_marks (
    chat_id   BIGINT      NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    up_to_seq BIGINT      NOT NULL,
    read_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id, up_to_seq)
);

-- Поиск «первая отметка с up_to_seq >= seq» и подчистка по дате.
CREATE INDEX IF NOT EXISTS chat_read_marks_lookup_idx
    ON chat_read_marks (chat_id, user_id, up_to_seq);
CREATE INDEX IF NOT EXISTS chat_read_marks_read_at_idx
    ON chat_read_marks (chat_id, user_id, read_at);

-- +goose Down
DROP TABLE IF EXISTS chat_read_marks;
