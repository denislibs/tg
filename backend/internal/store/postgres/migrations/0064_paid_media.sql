-- +goose Up
-- Платное медиа (Telegram paid media — медиа, разблокируемое за Stars): цена
-- доступа к медиа сообщения в звёздах хранится в отдельной таблице (а не колонкой
-- messages), read-модель подмешивает её при чтении. Получатель видит медиа
-- заблокированным (blur+цена), сервер не отдаёт байты до оплаты.
CREATE TABLE paid_media (
	message_id  BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
	price_stars BIGINT NOT NULL CHECK (price_stars > 0)
);

-- Разблокировки: (сообщение, пользователь) — кто уже оплатил доступ к медиа.
-- Автор доступ имеет всегда (проверяется по sender_id), в таблицу не пишется.
CREATE TABLE paid_media_unlocks (
	message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
	user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (message_id, user_id)
);

-- +goose Down
DROP TABLE paid_media_unlocks;
DROP TABLE paid_media;
