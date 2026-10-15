-- +goose Up
-- Ф7-Г2. Ключи идемпотентности платной ⭐-реакции: TL messages.sendPaidReaction несёт
-- random_id:long (tweb appReactionsManager.ts:960-970), повтор запроса с тем же ключом
-- не списывает звёзды второй раз. Ключ уникален в паре с пользователем; строки старше суток
-- чистятся запросами того же пользователя (окно повтора — потерянный ответ, прокси).
-- Идемпотентная (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS star_reaction_requests (
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  random_id  BIGINT      NOT NULL,
  message_id BIGINT      NOT NULL,
  stars      BIGINT      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, random_id)
);
-- Чистка устаревших ключей пользователя: WHERE user_id = $1 AND created_at < …
CREATE INDEX IF NOT EXISTS idx_star_reaction_requests_user_created
  ON star_reaction_requests (user_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS star_reaction_requests;
