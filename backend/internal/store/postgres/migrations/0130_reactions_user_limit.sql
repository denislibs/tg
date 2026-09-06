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
-- ЧИСЛА 3 И 1 ЗДЕСЬ ДУБЛИРУЮТ КОНСТАНТЫ reactionsUserMaxPremium /
-- reactionsUserMaxDefault (internal/usecase/chat/reaction.go). Свести в одно
-- место нельзя: миграция — статический SQL, goose применяет её без участия
-- кода. Когда лимит переедет в конфигурацию, ЭТИ числа менять не нужно и
-- нельзя: они описывают уже применённую однажды чистку, а не текущее правило.
--
-- ТЕГИ «ИЗБРАННОГО» ЗДЕСЬ НЕ ТРОГАЮТСЯ (`c.type <> 'saved'`). Тег — это строка
-- в этой же таблице reactions: реакция владельца на сообщение своего самочата
-- (adapter/repo/postgres/savedtagsrepo.go:24-33), поставленная тем же POST. Без
-- этого условия миграция БЕЗВОЗВРАТНО стёрла бы уже расставленные
-- пользователем теги, оставив по одному на заметку у каждого не-подписчика.
-- В оригинале такого состояния не бывает: там тег ставит только премиум
-- (не-подписчику показывают PopupPremium 'saved_tags', tweb
-- src/components/chat/contextMenu.ts:1681-1684), — премиум-гейт на теги мы не
-- портировали, а лимит портировали, и применять половину связки к чужим данным
-- нельзя. Юзкейс исключает теги ровно тем же признаком (isSavedTag), долг на
-- вторую половину — backend/backlogs/saved-tags-under-reactions-limit.md.
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
     JOIN messages m ON m.id = re.message_id
     JOIN chats c ON c.id = m.chat_id
    WHERE c.type <> 'saved'
 ) x
 WHERE r.ctid = x.id AND x.rn > x.lim;

-- +goose Down
-- Необратимо: снятые реакции восстановить не из чего (журнала реакций нет).
-- Обратный ход существует только чтобы goose мог пройти вниз мимо этой версии.
SELECT 1;
