-- +goose Up
-- Единица giveaways.stars у звёздных розыгрышей: ОБЩАЯ сумма розыгрыша, как в
-- messageMediaGiveaway.stars (tweb chat/giveaway.tsx:199), а не «каждому
-- победителю». Прежние значения (на победителя) переводятся в общую сумму;
-- вклад deposit уже хранит общую сумму. Деньги считаются из deposit, не из stars.
-- Журнал обновлений (updates / channel_updates) не переписывается: снимки
-- розыгрышей, записанные до миграции, показывают прежнюю цифру до ближайшего
-- giveaway_update (розыгрыши появились сутки назад, окно принято).
UPDATE giveaways SET stars = stars * winners_count WHERE prize_kind = 'stars';

-- +goose Down
-- Деление целочисленное: у сумм, не кратных числу победителей, точность теряется.
UPDATE giveaways SET stars = stars / winners_count WHERE prize_kind = 'stars' AND winners_count > 0;
