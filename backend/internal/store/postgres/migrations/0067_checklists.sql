-- +goose Up
-- Чек-листы (Telegram todo list / messageMediaToDo): интерактивный список задач.
-- Как и опрос, чек-лист — отдельная сущность; сообщение типа 'checklist'
-- ссылается на неё через messages.checklist_id. Пункты хранятся структурно в
-- jsonb (массив {id,text}, id последовательные), отметки «выполнено» — по строке
-- на (checklist, item, user): один пункт может отметить несколько участников,
-- поэтому видно, КТО отметил.
CREATE TABLE checklists (
    id              BIGSERIAL PRIMARY KEY,
    chat_id         BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    items           JSONB NOT NULL,                    -- массив {id,text}
    others_can_add  BOOLEAN NOT NULL DEFAULT false,    -- другие могут добавлять пункты
    others_can_mark BOOLEAN NOT NULL DEFAULT false,    -- другие могут отмечать выполненными
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checklist_marks (
    checklist_id BIGINT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    item_id      INT NOT NULL,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (checklist_id, item_id, user_id)
);

ALTER TABLE messages ADD COLUMN checklist_id BIGINT REFERENCES checklists(id);

-- +goose Down
ALTER TABLE messages DROP COLUMN checklist_id;
DROP TABLE checklist_marks;
DROP TABLE checklists;
