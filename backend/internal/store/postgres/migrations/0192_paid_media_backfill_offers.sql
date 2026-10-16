-- +goose Up
-- Бэкфилл предложений платного медиа для копий, созданных до 0140
-- (source_message_id, 2026-10-06). Замок байтов теперь держится на строке
-- paid_media у КАЖДОЙ продающей копии (MediaAccessRepo.CanAccess →
-- paidMediaLockedFor), поэтому копии старой формы иначе остались бы открытыми
-- или продавались бы пересылающим.
--
-- Покупки не теряются: до 0140 разблокировка копии лежала в
-- paid_media_unlocks(message_id = копия), а замок теперь ищет её по предложению
-- (исходнику). Поэтому разблокировки переезжают на новое предложение в той же
-- миграции, иначе купивший платил бы второй раз — другому продавцу.
--
-- (а) Пересланная копия платного со своей строкой paid_media без источника:
-- продавалась пересылающим. Предложение — исходник (или ЕГО предложение, если
-- исходник сам копия). Повтор безопасен: условие source_message_id IS NULL.
WITH moved AS (
    UPDATE paid_media p
    SET source_message_id = COALESCE(s.source_message_id, s.message_id)
    FROM messages m
    JOIN paid_media s ON s.message_id = m.fwd_from_msg_id
    WHERE m.id = p.message_id
      AND p.source_message_id IS NULL
      AND m.fwd_from_msg_id IS NOT NULL
      AND m.fwd_from_msg_id <> m.id
    RETURNING p.message_id AS old_offer, p.source_message_id AS new_offer
)
INSERT INTO paid_media_unlocks (message_id, user_id, unlocked_at)
SELECT mv.new_offer, u.user_id, u.unlocked_at
FROM moved mv
JOIN paid_media_unlocks u ON u.message_id = mv.old_offer
ON CONFLICT DO NOTHING;

-- Цепочка копия-от-копии: копия C, сделанная после 0140 от копии старой формы A,
-- получила source = A (Offers разрешает предложение одним шагом). После (а) у A
-- уже есть источник — C и отложенные пересылки A (params.fwd.offer_id = A)
-- переводятся на исходник A, вместе с разблокировками предложения A.
-- Повтор безопасен: после схлопывания у предложения источника больше нет.
WITH collapsed AS (
    UPDATE paid_media p
    SET source_message_id = s.source_message_id
    FROM paid_media s
    WHERE s.message_id = p.source_message_id
      AND s.source_message_id IS NOT NULL
    RETURNING p.source_message_id AS new_offer, s.message_id AS old_offer
)
INSERT INTO paid_media_unlocks (message_id, user_id, unlocked_at)
SELECT DISTINCT c.new_offer, u.user_id, u.unlocked_at
FROM collapsed c
JOIN paid_media_unlocks u ON u.message_id = c.old_offer
ON CONFLICT DO NOTHING;

UPDATE scheduled_messages sm
SET params = jsonb_set(sm.params, '{fwd,offer_id}', to_jsonb(s.source_message_id))
FROM paid_media s
WHERE sm.params->'fwd'->>'offer_id' ~ '^[0-9]+$'
  AND s.message_id = (sm.params->'fwd'->>'offer_id')::bigint
  AND s.source_message_id IS NOT NULL;

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

-- Не покрыто (данных для восстановления нет): копии со скрытым автором
-- (fwd_from_msg_id обнулён приватностью), пересылка «без автора» и от имени
-- чужого пира; копии и зеркала, чей исходник удалён жёстко (строки paid_media
-- исходника и цена ушли каскадом) — они остаются своим предложением.

-- +goose Down
-- No-op: бэкфилл восстанавливает недостающие данные; откат вернул бы копиям
-- старой формы продажу пересылающим и бесплатные зеркала, а отличить
-- заполненные здесь строки от записанных кодом после 0140 нельзя.
SELECT 1;
