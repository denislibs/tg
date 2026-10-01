-- +goose Up
-- Заметка контакта — TextWithEntities, как у оригинала (userFull.note,
-- contacts.addContact.note, contacts.updateContactNote): текст с разметкой.
-- Текст остаётся в contacts.note, разметка — рядом, тем же JSON-вектором
-- MessageEntity, что messages.entities. Пустой вектор — [], а не NULL:
-- в схеме параметр entities обязателен.
ALTER TABLE contacts ADD COLUMN note_entities JSONB NOT NULL DEFAULT '[]';

-- +goose Down
ALTER TABLE contacts DROP COLUMN note_entities;
