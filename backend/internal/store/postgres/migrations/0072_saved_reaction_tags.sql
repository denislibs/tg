-- +goose Up
-- Имена тегов-реакций «Избранного» (Telegram saved reaction tags). В Saved Messages
-- любая реакция на сообщение самочата — это тег; здесь хранится необязательное
-- ИМЯ тега, заданное пользователем (updateSavedReactionTag). Пустое имя = строки
-- нет. Сам список тегов и счётчики НЕ денормализуются: они вычисляются из
-- reactions по самочату (см. SavedTagsRepo.ListWithCounts) — источник истины один.
CREATE TABLE saved_reaction_tags (
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT   NOT NULL,
  title    TEXT   NOT NULL,
  PRIMARY KEY (user_id, reaction)
);

-- +goose Down
DROP TABLE saved_reaction_tags;
