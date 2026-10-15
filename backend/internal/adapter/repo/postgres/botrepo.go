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

// BotChats — чаты бота заданных видов (types: 'private', 'group'), не больше
// limit. Каналы-вещание, «Избранное» и секретные чаты не входят: команд там не
// показывают, а без отбора в запросе они съедали бы предел рассылки.
// План: idx_chat_members_user (user_id) + Nested Loop по chats_pkey.
func (r *BotRepo) BotChats(ctx context.Context, botID int64, types []string, limit int) ([]domain.BotChat, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.chat_id, c.type
		   FROM chat_members m JOIN chats c ON c.id = m.chat_id
		  WHERE m.user_id = $1 AND c.type = ANY($2)
		  LIMIT $3`, botID, types, limit)
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

// ChatRecipients — получатели в этих чатах (не больше limit): участники, кроме
// самого бота и других ботов (им карточку с командами никто не читает), с
// признаком «создатель или админ». Фильтр сужает до одного пользователя
// (PK-поиск) или до админов (idx_chat_members_chat_staff) — узкое изменение не
// читает всю группу. Строк больше limit — вызывающий видит превышение предела.
func (r *BotRepo) ChatRecipients(ctx context.Context, botID int64, chatIDs []int64, f domain.BotRecipientFilter, limit int) ([]domain.BotRecipient, error) {
	if len(chatIDs) == 0 {
		return nil, nil
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.chat_id, m.user_id, m.role IN ('creator','admin')
		   FROM chat_members m JOIN users u ON u.id = m.user_id AND NOT u.is_bot
		  WHERE m.chat_id = ANY($1) AND m.user_id <> $2
		    AND ($3 = 0 OR m.user_id = $3)
		    AND (NOT $4 OR m.role IN ('creator','admin'))
		  LIMIT $5`, chatIDs, botID, f.UserID, f.StaffOnly, limit)
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

// GroupLists — списки бота (язык "") для набора чатов ОДНИМ запросом:
// безадресные скоупы, chat/chat_administrators этих групп и записи chat_member.
// Приоритет раскладывает domain.BotGroupLists.ResolveGroup — запроса на группу нет.
func (r *BotRepo) GroupLists(ctx context.Context, botID int64, chatIDs []int64) (domain.BotGroupLists, error) {
	out := domain.BotGroupLists{
		Global: map[string][]domain.BotCommand{},
		Chat:   map[int64]map[string][]domain.BotCommand{},
		Member: map[int64]map[int64][]domain.BotCommand{},
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT scope, scope_chat_id, scope_user_id, command, description FROM bot_commands
		  WHERE bot_id = $1 AND language_code = ''
		    AND ((scope_chat_id = 0 AND scope_user_id = 0 AND scope IN ('default','all_private_chats','all_group_chats','all_chat_administrators'))
		      OR (scope IN ('chat','chat_administrators') AND scope_chat_id = ANY($2) AND scope_user_id = 0)
		      OR (scope = 'chat_member' AND scope_chat_id = ANY($2)))
		  ORDER BY sort, command`, botID, chatIDs)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			scope        string
			chatID, user int64
			c            domain.BotCommand
		)
		if err := rows.Scan(&scope, &chatID, &user, &c.Command, &c.Description); err != nil {
			return out, err
		}
		switch scope {
		case domain.BotScopeChatMember:
			if out.Member[chatID] == nil {
				out.Member[chatID] = map[int64][]domain.BotCommand{}
			}
			out.Member[chatID][user] = append(out.Member[chatID][user], c)
		case domain.BotScopeChat, domain.BotScopeChatAdministrator:
			if out.Chat[chatID] == nil {
				out.Chat[chatID] = map[string][]domain.BotCommand{}
			}
			out.Chat[chatID][scope] = append(out.Chat[chatID][scope], c)
		default:
			out.Global[scope] = append(out.Global[scope], c)
		}
	}
	return out, rows.Err()
}

// ChatBotIDs — боты-участники чата (карточка группы), в порядке вступления.
// Обход со стороны ботов (idx_users_bots, 0176), а не по всем участникам: на
// чате в сотни тысяч человек это несколько чтений chat_members_pkey.
func (r *BotRepo) ChatBotIDs(ctx context.Context, chatID int64, limit int) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT m.user_id FROM users u JOIN chat_members m ON m.chat_id = $1 AND m.user_id = u.id
		  WHERE u.is_bot
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
