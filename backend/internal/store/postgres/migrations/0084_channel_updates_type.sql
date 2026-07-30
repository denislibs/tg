-- +goose Up
-- Волна 5: типизированный channel-конверт. Раньше channel_updates хранил только
-- payload нового поста (тип подразумевался new_message). Теперь по channel-логу
-- едут и метаданные канала (chat_update/boost_update), поэтому строке нужен тип,
-- чтобы GET /channels/{id}/difference отдавал типизированное {t,pts,d}, а клиент
-- маршрутизировал апдейт так же, как живой кадр. DEFAULT 'new_message' закрывает
-- уже накопленные строки (все они — посты).
ALTER TABLE channel_updates ADD COLUMN type TEXT NOT NULL DEFAULT 'new_message';

-- +goose Down
ALTER TABLE channel_updates DROP COLUMN type;
