package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// BotRepo — флаг is_bot и команды ботов (таблицы users.is_bot / bot_commands).
type BotRepo struct {
	pool *pgxpool.Pool
}

func NewBotRepo(pool *pgxpool.Pool) *BotRepo { return &BotRepo{pool: pool} }

func (r *BotRepo) IsBot(ctx context.Context, userID int64) (bool, error) {
	var isBot bool
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT is_bot FROM users WHERE id=$1`, userID).Scan(&isBot)
	if err != nil {
		return false, nil // нет юзера — не бот (мягко)
	}
	return isBot, nil
}

// CommandsFor — список команд бота глазами зрителя. chatID == 0 — личка с ботом;
// иначе группа, isAdmin — зритель создатель или админ этой группы. Приоритет
// скоупов (Bot API «Determining list of commands»), внутри скоупа — точный язык,
// затем пустой:
//
//	группа: chat_member(chat, viewer) → chat_administrators(chat) [админ] → chat(chat)
//	        → all_chat_administrators [админ] → all_group_chats → default
//	личка:  all_private_chats → default
//
// viewerID == 0 — «зрителя нет»: запись chat_member не подходит никому (расчёт
// тела рассылки для рядовых участников).
func (r *BotRepo) CommandsFor(ctx context.Context, botID, chatID, viewerID int64, isAdmin bool, lang string) ([]domain.BotCommand, error) {
	m, err := r.CommandsForBots(ctx, []int64{botID}, chatID, viewerID, isAdmin, lang)
	if err != nil {
		return nil, err
	}
	return m[botID], nil
}

// CommandsForBots — то же для набора ботов одним запросом (карточка группы с
// несколькими ботами). Боты без списка в карте отсутствуют.
func (r *BotRepo) CommandsForBots(ctx context.Context, botIDs []int64, chatID, viewerID int64, isAdmin bool, lang string) (map[int64][]domain.BotCommand, error) {
	out := map[int64][]domain.BotCommand{}
	if len(botIDs) == 0 {
		return out, nil
	}
	order := commandScopeOrder(chatID, viewerID, isAdmin)
	// Кандидаты — только строки, подходящие этому зрителю: безадресные скоупы и
	// адресные, чей адрес совпал. Приоритет и язык выбирает Go по уже малому набору.
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT bot_id, scope, language_code, command, description
		   FROM bot_commands
		  WHERE bot_id = ANY($1) AND language_code IN ('', $2)
		    AND ((scope_chat_id = 0 AND scope_user_id = 0 AND scope IN ('default','all_private_chats','all_group_chats','all_chat_administrators'))
		      OR (scope IN ('chat','chat_administrators') AND scope_chat_id = $3 AND scope_user_id = 0)
		      OR (scope = 'chat_member' AND scope_chat_id = $3 AND scope_user_id = $4 AND $4 <> 0))
		  ORDER BY bot_id, sort, command`, botIDs, lang, chatID, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type key struct {
		bot         int64
		scope, lang string
	}
	byKey := map[key][]domain.BotCommand{}
	for rows.Next() {
		var (
			bot            int64
			scope, l, c, d string
		)
		if err := rows.Scan(&bot, &scope, &l, &c, &d); err != nil {
			return nil, err
		}
		k := key{bot, scope, l}
		byKey[k] = append(byKey[k], domain.BotCommand{Command: c, Description: d})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, bot := range botIDs {
	pick:
		for _, scope := range order {
			for _, l := range []string{lang, ""} {
				if cs := byKey[key{bot, scope, l}]; len(cs) > 0 {
					out[bot] = cs
					break pick
				}
			}
		}
	}
	return out, nil
}

// commandScopeOrder — скоупы по убыванию приоритета для зрителя.
func commandScopeOrder(chatID, viewerID int64, isAdmin bool) []string {
	if chatID == 0 {
		return []string{domain.BotScopeAllPrivateChats, domain.BotScopeDefault}
	}
	var order []string
	if viewerID != 0 {
		order = append(order, domain.BotScopeChatMember)
	}
	if isAdmin {
		order = append(order, domain.BotScopeChatAdministrator)
	}
	order = append(order, domain.BotScopeChat)
	if isAdmin {
		order = append(order, domain.BotScopeAllChatAdmins)
	}
	return append(order, domain.BotScopeAllGroupChats, domain.BotScopeDefault)
}

// BotChats — личные чаты и группы, где состоит бот (не больше limit). Каналы-
// вещание, «Избранное» и секретные чаты не входят: команд там не показывают, а
// без отбора в запросе они съедали бы предел рассылки.
// План: idx_chat_members_user (user_id) + Nested Loop по chats_pkey.
func (r *BotRepo) BotChats(ctx context.Context, botID int64, limit int) ([]domain.BotChat, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.chat_id, c.type
		   FROM chat_members m JOIN chats c ON c.id = m.chat_id
		  WHERE m.user_id = $1 AND c.type IN ('private', 'group')
		  LIMIT $2`, botID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BotChat
	for rows.Next() {
		var c domain.BotChat
		if err := rows.Scan(&c.ChatID, &c.Type); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CountChatMembers — число строк chat_members в этих чатах, но не больше limit
// (счёт обрывается на пределе: сверху он не нужен).
func (r *BotRepo) CountChatMembers(ctx context.Context, chatIDs []int64, limit int) (int, error) {
	if len(chatIDs) == 0 {
		return 0, nil
	}
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM (SELECT 1 FROM chat_members WHERE chat_id = ANY($1) LIMIT $2) t`,
		chatIDs, limit).Scan(&n)
	return n, err
}

// ChatRecipients — участники этих чатов, кроме самого бота, с признаком «создатель
// или админ».
func (r *BotRepo) ChatRecipients(ctx context.Context, botID int64, chatIDs []int64) ([]domain.BotRecipient, error) {
	if len(chatIDs) == 0 {
		return nil, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT chat_id, user_id, role IN ('creator','admin')
		   FROM chat_members WHERE chat_id = ANY($1) AND user_id <> $2`, chatIDs, botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BotRecipient
	for rows.Next() {
		var rc domain.BotRecipient
		if err := rows.Scan(&rc.ChatID, &rc.UserID, &rc.Staff); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// ChatMemberCommands — все списки бота со скоупом chat_member в этом чате (язык
// ""), по пользователям: одна выборка на чат вместо запроса на участника.
func (r *BotRepo) ChatMemberCommands(ctx context.Context, botID, chatID int64) (map[int64][]domain.BotCommand, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT scope_user_id, command, description FROM bot_commands
		  WHERE bot_id = $1 AND scope = 'chat_member' AND scope_chat_id = $2 AND language_code = ''
		  ORDER BY scope_user_id, sort, command`, botID, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]domain.BotCommand{}
	for rows.Next() {
		var (
			uid  int64
			c, d string
		)
		if err := rows.Scan(&uid, &c, &d); err != nil {
			return nil, err
		}
		out[uid] = append(out[uid], domain.BotCommand{Command: c, Description: d})
	}
	return out, rows.Err()
}

// ChatBotIDs — боты-участники чата (карточка группы), в порядке вступления.
func (r *BotRepo) ChatBotIDs(ctx context.Context, chatID int64, limit int) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.user_id FROM chat_members m JOIN users u ON u.id = m.user_id
		  WHERE m.chat_id = $1 AND u.is_bot
		  ORDER BY m.joined_at, m.user_id LIMIT $2`, chatID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
