-- +goose Up
-- Telegram Stars + Star Gifts (звёзды и подарки).
-- Реального платёжного провайдера нет: баланс ведётся здесь, пополнение —
-- dev-операция (мгновенно добавляет звёзды). Подарок за звёзды отправляется в
-- ЛС получателю сервис-сообщением (messages.gift_id → saved_star_gifts).

-- Баланс звёзд пользователя (одна строка на юзера, создаётся лениво).
CREATE TABLE user_stars (
    user_id INT8 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance INT8 NOT NULL DEFAULT 0
);

-- Каталог подарков (star gifts): что можно подарить. Ограниченные — с
-- остатком (remains убывает при отправке, sold_out при 0).
CREATE TABLE star_gifts (
    id          BIGSERIAL PRIMARY KEY,
    emoji       TEXT NOT NULL,          -- эмодзи-стикер подарка
    title       TEXT NOT NULL,
    price_stars INT8 NOT NULL,          -- цена покупки в звёздах
    convert_stars INT8 NOT NULL,        -- сколько звёзд вернётся при конвертации
    total       INT8,                   -- лимит выпуска (NULL — безлимитный)
    remains     INT8,                   -- сколько осталось (NULL — безлимитный)
    sort        INT8 NOT NULL DEFAULT 0 -- порядок в каталоге
);

-- Подарки, полученные пользователем. converted — обменян на звёзды (удалён из
-- витрины), hidden — скрыт из профиля (savedStarGift.pFlags.unsaved в tweb).
CREATE TABLE saved_star_gifts (
    id         BIGSERIAL PRIMARY KEY,
    owner_id   INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id    INT8 REFERENCES users(id) ON DELETE SET NULL,
    gift_id    INT8 NOT NULL REFERENCES star_gifts(id),
    message    TEXT NOT NULL DEFAULT '',
    anonymous  BOOLEAN NOT NULL DEFAULT false, -- имя отправителя скрыто
    hidden     BOOLEAN NOT NULL DEFAULT false, -- скрыт из профиля
    converted  BOOLEAN NOT NULL DEFAULT false, -- обменян на звёзды
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_gifts_owner ON saved_star_gifts(owner_id, created_at DESC);

-- Сообщение-подарок в ЛС ссылается на выданный подарок.
ALTER TABLE messages ADD COLUMN gift_id BIGINT REFERENCES saved_star_gifts(id);

-- Сид каталога: несколько подарков разной цены (эмодзи как «стикер»).
INSERT INTO star_gifts (emoji, title, price_stars, convert_stars, total, remains, sort) VALUES
    ('🌹', 'Роза',        15,   15,   NULL, NULL, 1),
    ('🎂', 'Торт',        50,   50,   NULL, NULL, 2),
    ('🎁', 'Подарок',     25,   25,   NULL, NULL, 3),
    ('🧸', 'Мишка',       100,  100,  NULL, NULL, 4),
    ('💍', 'Кольцо',      1000, 1000, 5000, 5000, 5),
    ('🚀', 'Ракета',      500,  500,  NULL, NULL, 6),
    ('🏆', 'Кубок',       250,  250,  2000, 2000, 7),
    ('💎', 'Бриллиант',   2000, 2000, 1000, 1000, 8);

-- +goose Down
ALTER TABLE messages DROP COLUMN gift_id;
DROP TABLE saved_star_gifts;
DROP TABLE star_gifts;
DROP TABLE user_stars;
