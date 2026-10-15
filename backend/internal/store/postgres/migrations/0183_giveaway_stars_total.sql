-- +goose Up
-- Единица giveaways.stars у звёздных розыгрышей: ОБЩАЯ сумма розыгрыша, как в
-- messageMediaGiveaway.stars (tweb chat/giveaway.tsx:199), а не «каждому
-- победителю». Прежние значения (на победителя) переводятся в общую сумму;
-- вклад deposit уже хранит общую сумму.
UPDATE giveaways SET stars = stars * winners_count WHERE prize_kind = 'stars';

-- +goose Down
UPDATE giveaways SET stars = stars / winners_count WHERE prize_kind = 'stars' AND winners_count > 0;
