-- +goose Up
-- Из кадров журнала КАНАЛА убран второй ключ пира.
--
-- Общая функция рассылки дописывала в тело `peer_id` голым числом, хотя у
-- конструктора место пира своё (`peer:Peer`) и строитель тела его уже заполнил.
-- Два имени одного факта — тот же дефект, что `channel_pts` рядом с `pts`:
-- получатель начинал решать вид кадра по имени ключа.

UPDATE channel_updates SET payload = payload - 'peer_id'
 WHERE payload ? 'peer_id' AND payload ? 'peer';

-- +goose Down
-- Обратный ход восстанавливает число из ключа самой строки журнала.

UPDATE channel_updates SET payload = jsonb_set(payload, '{peer_id}', to_jsonb(-channel_id))
 WHERE payload ? 'peer' AND NOT (payload ? 'peer_id');
