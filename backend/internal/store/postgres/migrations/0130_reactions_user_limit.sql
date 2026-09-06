-- +goose Up
-- Приведение уже накопленных реакций к правилу «один пользователь — не больше N
-- своих реакций на одном сообщении» (usecase/chat/reaction.go::evictExcessReactions).
--
-- N зависит от подписки: 1 без премиума, 3 с премиумом — дефолты Telegram
-- reactions_user_max_default / reactions_user_max_premium (tweb
-- src/lib/appManagers/apiManagerMethods.ts:375). Правило поэтому и не выражается
-- констрейнтом: лимит живёт в СТРОКЕ ДРУГОЙ ТАБЛИЦЫ (users.is_premium), а
-- CHECK/UNIQUE её не видят. Констрейнт здесь и не добавляется — инвариант держит
-- юзкейс, эта миграция лишь чинит данные, накопленные до него.
--
-- Оставляем НОВЕЙШИЕ: вытеснение в оригинале снимает самые старые свои реакции
-- (appReactionsManager.ts:733-751), и разовая чистка обязана оставить ровно то,
-- что осталось бы после серии кликов.
DELETE FROM reactions r
 USING (
   SELECT re.ctid AS id,
          row_number() OVER (
            PARTITION BY re.message_id, re.user_id
            ORDER BY re.created_at DESC, re.emoji DESC
          ) AS rn,
          CASE WHEN u.is_premium THEN 3 ELSE 1 END AS lim
     FROM reactions re
     JOIN users u ON u.id = re.user_id
 ) x
 WHERE r.ctid = x.id AND x.rn > x.lim;

-- +goose Down
-- Необратимо: снятые реакции восстановить не из чего (журнала реакций нет).
-- Обратный ход существует только чтобы goose мог пройти вниз мимо этой версии.
SELECT 1;
