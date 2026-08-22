-- +goose Up
-- Кадр с сообщением стал КОНСТРУКТОРОМ: у замороженных кадров журналов
-- появляются дискриминатор `_` и `pts_count`.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р1, Р2). Наш кадр был
-- конвертом `{t: "new_message", d: {message: …}}`: вид кадра выражен СТРОКОЙ
-- рядом с телом. В схеме вид выражает сам конструктор — updateNewMessage для
-- личного чата и группы, updateNewChannelMessage для поста канала, — а курсор
-- лежит внутри него параметром.
--
-- Отсюда долг: кадры, записанные ДО порта, дискриминатора не имеют. Клиент
-- переигрывает их при /sync и channels.getDifference, и после того как разбор
-- начнёт ветвиться по `_` (шаг C), переигранный старый кадр стал бы
-- неопознанным — то есть история после разрыва связи просто не доехала бы. Та
-- же дисциплина, что у 0100, 0101, 0106, 0107, 0108, 0110: постоянный
-- переходник и есть тот второй источник истины, ради устранения которого
-- делается переход.
--
-- Какой конструктор ставить, решает НЕ тип записи (он у обеих таблиц один и тот
-- же — "new_message"), а ТАБЛИЦА: в channel_updates по построению лежат только
-- посты каналов (пер-канальный курсор), в updates — всё остальное. Ровно та же
-- развилка, что на живой доставке: вид определяет пир, а не имя ручки.

UPDATE updates
   SET payload = payload || jsonb_build_object('_', 'updateNewMessage', 'pts_count', 1)
 WHERE type = 'new_message'
   AND payload IS NOT NULL
   AND NOT (payload ? '_');

UPDATE channel_updates
   SET payload = payload || jsonb_build_object('_', 'updateNewChannelMessage', 'pts_count', 1)
 WHERE type = 'new_message'
   AND payload IS NOT NULL
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход снимает оба ключа — форма кадра возвращается к той, что была до
-- порта. Информация не теряется: и вид кадра, и шаг курсора выводятся обратно
-- из таблицы и из плотности курсора.

UPDATE updates
   SET payload = payload - '_' - 'pts_count'
 WHERE type = 'new_message'
   AND payload IS NOT NULL
   AND payload->>'_' = 'updateNewMessage';

UPDATE channel_updates
   SET payload = payload - '_' - 'pts_count'
 WHERE type = 'new_message'
   AND payload IS NOT NULL
   AND payload->>'_' = 'updateNewChannelMessage';
