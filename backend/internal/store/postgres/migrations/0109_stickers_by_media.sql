-- +goose Up
-- Избранное и недавние стикеры перекладываются с суррогатного ключа строки
-- набора (stickers.id) на КЛЮЧ ФАЙЛА (media_id).
--
-- Разбор — docs/readiness/tl-stickers-analysis.md, Р2. Коротко: в схеме стикер
-- это Document, и `messages.faveSticker`/`messages.saveRecentSticker`
-- принимают InputDocument, то есть файл. Наш `stickers.id` — ключ строки
-- «файл В ЭТОМ наборе», и у него нет уникального индекса по media_id: один и
-- тот же файл может числиться в двух наборах (Telegram переиспользует
-- документы).
--
-- Из-за этого прежняя раскладка давала два дефекта, которые новый ключ
-- устраняет не проверкой, а невыразимостью:
--
--   1. ДУБЛИ. Файл, добавленный в избранное из двух наборов, попадал в список
--      дважды — панель показывала один стикер два раза;
--   2. ПОТЕРЯ ПРИ УДАЛЕНИИ НАБОРА. Ссылка шла на stickers(id) с ON DELETE
--      CASCADE, поэтому удаление набора стирало избранное пользователя даже
--      когда тот же файл оставался в другом, живом наборе.
--
-- Перекладка дедуплицирует на лету: при двух строках на один файл остаётся
-- САМАЯ СВЕЖАЯ отметка времени — это ровно то, что пользователь и увидел бы,
-- будь ключ правильным с самого начала.

ALTER TABLE recent_stickers ADD COLUMN media_id BIGINT REFERENCES media(id);
ALTER TABLE faved_stickers  ADD COLUMN media_id BIGINT REFERENCES media(id);

UPDATE recent_stickers rs SET media_id = st.media_id
  FROM stickers st WHERE st.id = rs.sticker_id;
UPDATE faved_stickers fs SET media_id = st.media_id
  FROM stickers st WHERE st.id = fs.sticker_id;

-- Строки-сироты (стикер уже удалён, а запись пережила её из-за отсутствия
-- каскада в какой-то момент истории) переносить некуда — их и не должно быть.
DELETE FROM recent_stickers WHERE media_id IS NULL;
DELETE FROM faved_stickers  WHERE media_id IS NULL;

-- Дедупликация: на пару (user_id, media_id) остаётся запись с новейшей меткой.
DELETE FROM recent_stickers a USING recent_stickers b
 WHERE a.user_id = b.user_id AND a.media_id = b.media_id
   AND (a.used_at, a.sticker_id) < (b.used_at, b.sticker_id);
DELETE FROM faved_stickers a USING faved_stickers b
 WHERE a.user_id = b.user_id AND a.media_id = b.media_id
   AND (a.faved_at, a.sticker_id) < (b.faved_at, b.sticker_id);

ALTER TABLE recent_stickers ALTER COLUMN media_id SET NOT NULL;
ALTER TABLE faved_stickers  ALTER COLUMN media_id SET NOT NULL;

ALTER TABLE recent_stickers DROP CONSTRAINT recent_stickers_pkey;
ALTER TABLE faved_stickers  DROP CONSTRAINT faved_stickers_pkey;
ALTER TABLE recent_stickers DROP COLUMN sticker_id;
ALTER TABLE faved_stickers  DROP COLUMN sticker_id;
ALTER TABLE recent_stickers ADD PRIMARY KEY (user_id, media_id);
ALTER TABLE faved_stickers  ADD PRIMARY KEY (user_id, media_id);

-- +goose Down
-- Обратный ход восстанавливает ключ строки набора. Выбор строки при этом
-- НЕОДНОЗНАЧЕН (файл может быть в двух наборах) — берём наименьший stickers.id,
-- то есть тот набор, куда файл попал раньше. Точное восстановление невозможно
-- в принципе: прямой ход потерял информацию «из какого набора добавили», и
-- именно потому, что она лишняя.
ALTER TABLE recent_stickers ADD COLUMN sticker_id BIGINT REFERENCES stickers(id) ON DELETE CASCADE;
ALTER TABLE faved_stickers  ADD COLUMN sticker_id BIGINT REFERENCES stickers(id) ON DELETE CASCADE;

UPDATE recent_stickers rs SET sticker_id = (
  SELECT min(st.id) FROM stickers st WHERE st.media_id = rs.media_id);
UPDATE faved_stickers fs SET sticker_id = (
  SELECT min(st.id) FROM stickers st WHERE st.media_id = fs.media_id);

DELETE FROM recent_stickers WHERE sticker_id IS NULL;
DELETE FROM faved_stickers  WHERE sticker_id IS NULL;

ALTER TABLE recent_stickers DROP CONSTRAINT recent_stickers_pkey;
ALTER TABLE faved_stickers  DROP CONSTRAINT faved_stickers_pkey;
ALTER TABLE recent_stickers DROP COLUMN media_id;
ALTER TABLE faved_stickers  DROP COLUMN media_id;
ALTER TABLE recent_stickers ADD PRIMARY KEY (user_id, sticker_id);
ALTER TABLE faved_stickers  ADD PRIMARY KEY (user_id, sticker_id);
