-- +goose Up
-- Повторяемая (IF NOT EXISTS).
--
-- Ф-6, f6-contact (решение В-10). Сообщение-визитка хранит поля inputMediaContact
-- так, как их прислал отправитель (tweb getContactMediaInput,
-- appUsersManager.ts:977-988; messageMediaContact, appMessagesManager.ts:4035-4045):
-- first_name, last_name, phone_number, vcard. contact_name дальше значит
-- first_name; у старых строк в нём полное имя — допустимо. contact_user_id —
-- аккаунт, который сервер вывел по номеру (NULL — не найден или скрыт правилом
-- added_by_phone, на проводе user_id=0).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_last_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_vcard TEXT;

-- +goose Down
-- Потеря данных при откате: фамилии и vcard визиток.
ALTER TABLE messages DROP COLUMN IF EXISTS contact_vcard;
ALTER TABLE messages DROP COLUMN IF EXISTS contact_last_name;
