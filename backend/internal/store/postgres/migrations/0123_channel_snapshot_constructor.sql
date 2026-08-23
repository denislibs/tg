-- +goose Up
-- Снимок карточки в журнале КАНАЛА получил свой конструктор:
--
--   channel_updates.chat_update: updateChatFullSnapshot → updateChannelFullSnapshot
--
-- Предмет тот же, а курсор разный: этот кадр двигает пер-КАНАЛЬНЫЙ pts, а
-- одноимённый кадр в персональных журналах — пер-юзерный. Пока конструктор был
-- один на оба журнала, получатель не мог решить, какой курсор двигать: по
-- снимку карточки это не видно (наша группа в модели тоже channel — решение №2
-- порта пиров), а прежнее второе имя ключа (`channel_pts`) шаг B снял.
--
-- Схема отвечает на этот вопрос ровно так же — updateNewMessage против
-- updateNewChannelMessage, updateEditMessage против updateEditChannelMessage:
-- предмет один, журналов два, различает их КОНСТРУКТОР.
--
-- Тела в персональных журналах (`updates`) не трогаются: там кадр по-прежнему
-- updateChatFullSnapshot.

UPDATE channel_updates SET payload = jsonb_set(payload, '{_}', '"updateChannelFullSnapshot"')
 WHERE type = 'chat_update' AND payload->>'_' = 'updateChatFullSnapshot';

-- +goose Down

UPDATE channel_updates SET payload = jsonb_set(payload, '{_}', '"updateChatFullSnapshot"')
 WHERE type = 'chat_update' AND payload->>'_' = 'updateChannelFullSnapshot';
