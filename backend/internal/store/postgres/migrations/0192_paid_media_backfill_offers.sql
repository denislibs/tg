-- +goose Up
-- Бэкфилл предложений платного медиа для копий, созданных до 0140
-- (source_message_id, 2026-10-06). Замок байтов теперь держится на строке
-- paid_media у КАЖДОЙ продающей копии (MediaAccessRepo.CanAccess →
-- paidMediaLockedFor), поэтому копии старой формы иначе остались бы открытыми
-- или продавались бы пересылающим.
--
-- (а) Пересланная копия платного со своей строкой paid_media без источника:
-- продавалась пересылающим. Предложение — исходник (или ЕГО предложение, если
-- исходник сам копия). Повтор безопасен: условие source_message_id IS NULL.
UPDATE paid_media p
SET source_message_id = COALESCE(s.source_message_id, s.message_id)
FROM messages m
JOIN paid_media s ON s.message_id = m.fwd_from_msg_id
WHERE m.id = p.message_id
  AND p.source_message_id IS NULL
  AND m.fwd_from_msg_id IS NOT NULL
  AND m.fwd_from_msg_id <> m.id;

-- (б) Зеркало платного поста в группе обсуждения без строки paid_media:
-- раздавалось даром. Продаётся предложением поста, той же ценой.
-- Повтор безопасен: ON CONFLICT по первичному ключу.
INSERT INTO paid_media (message_id, price_stars, source_message_id)
SELECT m.id, s.price_stars, COALESCE(s.source_message_id, s.message_id)
FROM messages m
JOIN paid_media s ON s.message_id = m.fwd_from_msg_id
WHERE m.is_discussion_mirror
  AND m.media_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM paid_media x WHERE x.message_id = m.id)
ON CONFLICT (message_id) DO NOTHING;

-- +goose Down
-- No-op: бэкфилл восстанавливает недостающие данные; откат вернул бы копиям
-- старой формы продажу пересылающим и бесплатные зеркала, а отличить
-- заполненные здесь строки от записанных кодом после 0140 нельзя.
SELECT 1;
