-- +goose Up
-- Номер служебного аккаунта Telegram — настоящий, 42777: его показывает
-- строка «Phone» правой панели профиля оригинала («+42 777», tweb
-- peerProfile.tsx `Phone` форматирует user.phone). Миграция 0014 положила
-- заглушку по шаблону безномерных аккаунтов ('+0000000' || id), и профиль
-- 777000 показывал её.
UPDATE users SET phone = '+42777' WHERE id = 777000 AND phone = '+0000000777000';

-- +goose Down
UPDATE users SET phone = '+0000000777000' WHERE id = 777000 AND phone = '+42777';
