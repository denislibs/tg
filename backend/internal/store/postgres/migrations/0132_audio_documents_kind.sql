-- +goose Up
-- Трек, отправленный «как файл», — это вид 'audio', а не 'document'.
--
-- Вид сообщения у нас решает, какими атрибутами описан документ
-- (domain.MediaSource.attributes: documentAttributeAudio у 'audio') и в какую
-- вкладку шаред-медиа оно попадает (mediaFilterCond: 'music' = type 'audio',
-- 'files' = type 'document'). Клиент слал mp3, выбранный пунктом «Файл», видом
-- 'document' — сообщение уезжало без documentAttributeAudio (tweb рисовал
-- файл вместо плеера) и не попадало во вкладку «Музыка».
--
-- У оригинала вид «музыка» решается по файлу: ветка
-- `fileType.indexOf('audio/') === 0 || ['video/ogg'].indexOf(fileType) >= 0`
-- в appMessagesManager.makeDocumentAndMetaForSendingFile стоит ДО
-- `!args.isMedia`. Новые сообщения нормализуются при приёме
-- (usecase/chat.Interactor.documentKind, domain.IsAudioMime); здесь — уже
-- лежащие. Условие по mime ДОСЛОВНО повторяет domain.IsAudioMime.
--
-- Голосовые не задеты: у них вид 'voice' (его решает флаг записи, а не mime),
-- а обновляются только строки вида 'document'.
UPDATE messages m SET type = 'audio'
  FROM media md
 WHERE m.media_id = md.id
   AND m.type = 'document'
   AND (md.mime LIKE 'audio/%' OR md.mime = 'video/ogg');

-- Отложенные уходят через Send и нормализовались бы при отправке, но до неё
-- список отложенных рисует их тем же видом — приводим сразу.
UPDATE scheduled_messages s SET type = 'audio'
  FROM media md
 WHERE s.media_id = md.id
   AND s.type = 'document'
   AND (md.mime LIKE 'audio/%' OR md.mime = 'video/ogg');

-- +goose Down
-- Необратимо по смыслу: после Up треки, честно отправленные видом 'audio', и
-- треки, приведённые из 'document', неразличимы. Откат схемы не требуется —
-- колонка и её значения остаются допустимыми.
SELECT 1;
