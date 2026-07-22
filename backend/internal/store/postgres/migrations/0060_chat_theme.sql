-- +goose Up
-- Тема оформления конкретного чата (Telegram messages.setChatTheme): именованная
-- тема применяется к диалогу для ОБОИХ участников. theme_id — id пресета на
-- клиенте (chatThemes.ts), пустой строки тут не бывает (сброс = удаление строки).
-- set_by — кто менял (для аудита); updated_at — когда.
CREATE TABLE chat_theme (
    chat_id    BIGINT      NOT NULL PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    theme_id   TEXT        NOT NULL,
    set_by     BIGINT      NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE chat_theme;
