-- +goose Up
-- Личное фото контакта (Telegram uploadContactProfilePhoto с save=true): владелец
-- задаёт фото, которое ОН видит вместо настоящего аватара контакта — в списке
-- диалогов, шапке чата и инфо-панели. Сам контакт об этом не знает и своё фото не
-- меняет. Направленное отношение owner→contact; ключ — пара, поэтому повторная
-- установка обновляет запись (upsert), а сброс — просто удаляет строку.
CREATE TABLE contact_custom_photo (
  owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_user_id)
);

-- +goose Down
DROP TABLE contact_custom_photo;
