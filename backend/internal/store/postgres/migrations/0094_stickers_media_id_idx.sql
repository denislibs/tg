-- +goose Up
-- stickers.media_id стал горячим путём, а индекса на него не было: 0051
-- проиндексировал только set_id. По media_id фильтруют три запроса, и все
-- вызываются на пользовательских действиях, а не в фоне:
--   • StickersRepo.SetByMediaID — на каждый клик по стикеру в чате (резолв
--     набора для попапа);
--   • StickersRepo.IsStickerMedia — на каждую отправку стикера (usecase/chat/
--     message.go) и на каждую проверку доступа к медиа-файлу стикера
--     (usecase/chat/reaction.go), то есть на каждую его загрузку.
-- Строк в таблице после заливки наборов Telegram ~13 тыс. — без индекса каждый
-- такой вызов идёт seq scan'ом по всей таблице.
CREATE INDEX stickers_media_id_idx ON stickers(media_id);

-- sticker_sets_rank_idx (0093) удаляем как заведомо неиспользуемый. Единственный
-- запрос, который сортирует по rank, — StickersRepo.FeaturedSets с
-- `ORDER BY (s.rank = 0), s.rank, s.id DESC`: ведущий ключ сортировки здесь
-- ВЫРАЖЕНИЕ `(s.rank = 0)`, а не колонка, поэтому btree по rank порядок не
-- отдаёт и планировщик его не возьмёт ни при каком плане. Второй вариант —
-- привести запрос к индексируемому виду — отвергнут: наборов сотни (сейчас
-- 338), полная сортировка такой таблицы дешевле, чем поддержка частичного
-- индекса на каждой записи ранга ради плана, который на этом объёме всё равно
-- останется seq scan + sort.
DROP INDEX sticker_sets_rank_idx;

-- +goose Down
CREATE INDEX sticker_sets_rank_idx ON sticker_sets(rank) WHERE rank > 0;
DROP INDEX stickers_media_id_idx;
