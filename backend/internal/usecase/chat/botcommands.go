package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"sort"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Команды ботов по скоупам, их карточки (bot_info) и рассылка смены.
//
// tweb читает команды из полной карточки пира: `userFull.bot_info` у бота,
// `chatFull.bot_info` (вектор) у группы (processPeerFullForCommands.ts:4-12), а
// смену узнаёт кадром updateBotCommands и кладёт её в закэшированную карточку,
// карточку не перечитывая (appProfileManager.ts:1560-1569, :425-456).

// botCommandsFanoutLimit — предел получателей updateBotCommands на ОДНО
// изменение. Это НАША константа, у tweb её нет: на стороне сервера Telegram
// рассылка ограничена его инфраструктурой, у нас — этой цифрой. Сверх предела
// не шлётся никому (всё или ничего): частичная рассылка оставила бы часть
// участников со старой подсказкой без возможности отличить их от остальных.
// Команды такой группе придут с полной карточкой при следующем открытии.
const botCommandsFanoutLimit = 5000

// botCommandsFanoutTimeout — срок рассылки после коммита списка команд; контекст
// запроса к этому моменту может быть отменён клиентом.
const botCommandsFanoutTimeout = 30 * time.Second

// botInfosLimit — сколько ботов группы кладётся в её карточку.
const botInfosLimit = 100

// botCommandsMax — предел длины списка (Bot API: до 100 команд на скоуп).
const botCommandsMax = 100

func (i *Interactor) botFanoutLimit() int {
	if i.botCommandsLimit > 0 {
		return i.botCommandsLimit
	}
	return botCommandsFanoutLimit
}

// BotSetCommands — setMyCommands: список команд бота для скоупа и языка. Пустой
// список снимает скоуп (как deleteMyCommands).
func (i *Interactor) BotSetCommands(ctx context.Context, bot domain.BotAccount, scope domain.BotCommandScope, lang string, cmds []domain.BotCommand) error {
	return i.setBotCommands(ctx, bot.BotID, scope, lang, cmds)
}

// BotDeleteCommands — deleteMyCommands: снять список ровно этого скоупа и языка.
func (i *Interactor) BotDeleteCommands(ctx context.Context, bot domain.BotAccount, scope domain.BotCommandScope, lang string) error {
	if err := i.checkCommandScope(ctx, bot.BotID, scope); err != nil {
		return err
	}
	if err := i.botAPI.DeleteCommands(ctx, bot.BotID, scope, lang); err != nil {
		return err
	}
	i.botCommandsChanged(ctx, bot.BotID, scope, lang)
	return nil
}

// BotGetCommands читает команды бота для скоупа/языка (getMyCommands).
func (i *Interactor) BotGetCommands(ctx context.Context, bot domain.BotAccount, scope domain.BotCommandScope, lang string) ([]domain.BotCommand, error) {
	if !scope.Valid() {
		return nil, domain.ErrInvalid
	}
	return i.botAPI.CommandsScoped(ctx, bot.BotID, scope, lang)
}

// setBotCommands — единственный путь записи списка: и Bot API, и мастер
// /setcommands у BotFather идут сюда, поэтому оба рассылают updateBotCommands.
func (i *Interactor) setBotCommands(ctx context.Context, botID int64, scope domain.BotCommandScope, lang string, cmds []domain.BotCommand) error {
	if err := checkBotCommands(cmds); err != nil {
		return err
	}
	if err := i.checkCommandScope(ctx, botID, scope); err != nil {
		return err
	}
	if err := i.botAPI.SetCommands(ctx, botID, scope, lang, cmds); err != nil {
		return err
	}
	i.botCommandsChanged(ctx, botID, scope, lang)
	return nil
}

// checkBotCommands: не больше botCommandsMax, имена не пустые и не повторяются
// (повтор нарушил бы первичный ключ таблицы).
func checkBotCommands(cmds []domain.BotCommand) error {
	if len(cmds) > botCommandsMax {
		return domain.ErrInvalid
	}
	seen := make(map[string]bool, len(cmds))
	for _, c := range cmds {
		if c.Command == "" || seen[c.Command] {
			return domain.ErrInvalid
		}
		seen[c.Command] = true
	}
	return nil
}

// checkCommandScope: тип известен, адрес на месте (domain.BotCommandScope.Valid),
// а адресный скоуп указывает на группу, где состоит бот. Скоуп `chat` личного
// чата не поддерживается: в личке действуют только all_private_chats и default.
func (i *Interactor) checkCommandScope(ctx context.Context, botID int64, scope domain.BotCommandScope) error {
	if !scope.Valid() {
		return domain.ErrInvalid
	}
	if scope.ChatID == 0 {
		return nil
	}
	typ, err := i.chats.ChatType(ctx, scope.ChatID)
	if err != nil {
		return err
	}
	if typ != domain.ChatTypeGroup {
		return domain.ErrInvalid
	}
	ok, err := i.chats.IsMember(ctx, scope.ChatID, botID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	return nil
}

// botCommandsChanged — единая точка после смены списка команд: updateBotCommands
// всем, чья подсказка могла поменяться. Зовётся ПОСЛЕ коммита записи; ошибку
// только логирует — ответ Bot API остаётся успешным.
//
// lang != "": язык зрителя у нас всегда пустой (колонки языка в users нет), и
// список для конкретного языка пользователям не виден, — рассылать нечего.
// scope сужает адресатов: адресные скоупы касаются одной группы, all_private_chats —
// только личек, all_group_chats и *_administrators — только групп.
func (i *Interactor) botCommandsChanged(ctx context.Context, botID int64, scope domain.BotCommandScope, lang string) {
	if lang != "" || i.bots == nil || i.updates == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), botCommandsFanoutTimeout)
	defer cancel()
	if err := i.fanoutBotCommands(ctx, botID, scope); err != nil {
		log.Printf("bot_commands: fanout bot=%d: %v", botID, err)
	}
}

// commandBatch — получатели с одинаковым телом кадра.
type commandBatch struct {
	body  map[string]any
	users []int64
}

func (i *Interactor) fanoutBotCommands(ctx context.Context, botID int64, scope domain.BotCommandScope) error {
	limit := i.botFanoutLimit()

	var chats []domain.BotChat
	if scope.ChatID != 0 {
		chats = []domain.BotChat{{ChatID: scope.ChatID, Type: domain.ChatTypeGroup}}
	} else {
		all, err := i.bots.BotChats(ctx, botID, limit+1)
		if err != nil {
			return err
		}
		if len(all) > limit {
			log.Printf("bot_commands: bot=%d: чатов больше предела %d, рассылки нет", botID, limit)
			return nil
		}
		chats = all
	}
	chatIDs := make([]int64, 0, len(chats))
	types := make(map[int64]string, len(chats))
	for _, c := range chats {
		switch {
		case c.Type == domain.ChatTypePrivate && scopeReachesPrivate(scope):
		case c.Type == domain.ChatTypeGroup && scopeReachesGroups(scope):
		default:
			continue // broadcast-каналы команд не показывают
		}
		chatIDs = append(chatIDs, c.ChatID)
		types[c.ChatID] = c.Type
	}
	if len(chatIDs) == 0 {
		return nil
	}
	n, err := i.bots.CountChatMembers(ctx, chatIDs, limit+1)
	if err != nil {
		return err
	}
	if n > limit {
		log.Printf("bot_commands: bot=%d: получателей больше предела %d, рассылки нет", botID, limit)
		return nil
	}
	recipients, err := i.bots.ChatRecipients(ctx, botID, chatIDs)
	if err != nil {
		return err
	}
	byChat := make(map[int64][]domain.BotRecipient, len(chatIDs))
	for _, r := range recipients {
		byChat[r.ChatID] = append(byChat[r.ChatID], r)
	}

	batches := map[string]*commandBatch{}
	add := func(key string, peer domain.Peer, cmds []domain.BotCommand, uid int64) {
		b := batches[key]
		if b == nil {
			b = &commandBatch{body: bodyMap(domain.NewUpdateBotCommands(peer, botID, cmds))}
			batches[key] = b
		}
		b.users = append(b.users, uid)
	}

	var privateCmds []domain.BotCommand
	privateLoaded := false
	sort.Slice(chatIDs, func(a, b int) bool { return chatIDs[a] < chatIDs[b] })
	for _, chatID := range chatIDs {
		rs := byChat[chatID]
		if len(rs) == 0 {
			continue
		}
		if types[chatID] == domain.ChatTypePrivate {
			if !privateLoaded {
				if privateCmds, err = i.bots.CommandsFor(ctx, botID, 0, 0, false, ""); err != nil {
					return err
				}
				privateLoaded = true
			}
			for _, r := range rs {
				add("private", domain.NewPeerUser(botID), privateCmds, r.UserID)
			}
			continue
		}

		// Группа: тело (а) рядовому, (б) админу, (в) пользователю с явной
		// записью chat_member. Выборок команд на чат не больше трёх.
		peer := domain.NewPeer(domain.ToPeerID(chatID, true))
		member, err := i.bots.ChatMemberCommands(ctx, botID, chatID)
		if err != nil {
			return err
		}
		var plain, staff []domain.BotCommand
		var plainLoaded, staffLoaded bool
		for _, r := range rs {
			if cmds := member[r.UserID]; len(cmds) > 0 {
				add(fmt.Sprintf("group/%d/member/%d", chatID, r.UserID), peer, cmds, r.UserID)
				continue
			}
			if r.Staff {
				if !staffLoaded {
					if staff, err = i.bots.CommandsFor(ctx, botID, chatID, 0, true, ""); err != nil {
						return err
					}
					staffLoaded = true
				}
				add(fmt.Sprintf("group/%d/staff", chatID), peer, staff, r.UserID)
				continue
			}
			if !plainLoaded {
				if plain, err = i.bots.CommandsFor(ctx, botID, chatID, 0, false, ""); err != nil {
					return err
				}
				plainLoaded = true
			}
			add(fmt.Sprintf("group/%d/plain", chatID), peer, plain, r.UserID)
		}
	}

	keys := make([]string, 0, len(batches))
	for k := range batches {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	date := nowUnix()
	var firstErr error
	for _, k := range keys {
		b := batches[k]
		slices.Sort(b.users)
		b.users = slices.Compact(b.users)
		payload, err := json.Marshal(b.body)
		if err != nil {
			firstErr = errors.Join(firstErr, err)
			continue
		}
		// Пачка по отсортированным id: разный порядок двух параллельных пачек
		// дал бы взаимную блокировку на строках курсоров.
		ptsByUser, err := i.updates.AppendUpdateBulk(ctx, b.users, 1, date, "bot_commands", payload)
		if err != nil {
			firstErr = errors.Join(firstErr, err)
			continue
		}
		if i.publisher == nil {
			continue
		}
		frames := make([][]byte, len(b.users))
		for n, uid := range b.users {
			frames[n] = framePts("bot_commands", b.body, ptsByUser[uid])
		}
		_ = i.publisher.PublishToUsers(ctx, b.users, frames)
	}
	return firstErr
}

func scopeReachesPrivate(s domain.BotCommandScope) bool {
	switch s.Norm() {
	case domain.BotScopeDefault, domain.BotScopeAllPrivateChats:
		return true
	}
	return false
}

func scopeReachesGroups(s domain.BotCommandScope) bool {
	return s.Norm() != domain.BotScopeAllPrivateChats
}

// bodyMap — тело кадра из конструктора домена (framePts дописывает курсор в
// конверт, ему нужна карта с дискриминатором `_`).
func bodyMap(v any) map[string]any {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return m
}

// BotInfo — карточка бота для полной карточки его профиля (privacy.BotInfoSource):
// описание, команды скоупа лички глазами зрителя, кнопка-меню; вторым значением —
// «о боте» (userFull.about). Бот без учётки Bot API (демо-бот, BotFather)
// получает карточку без описания.
func (i *Interactor) BotInfo(ctx context.Context, botID, viewerID int64) (*domain.BotInfo, string, error) {
	var cmds []domain.BotCommand
	if i.bots != nil {
		var err error
		if cmds, err = i.bots.CommandsFor(ctx, botID, 0, viewerID, false, ""); err != nil {
			return nil, "", err
		}
	}
	var acc domain.BotAccount
	if i.botAPI != nil {
		var err error
		if acc, err = i.botAPI.BotByID(ctx, botID); err != nil && !errors.Is(err, domain.ErrNotFound) {
			return nil, "", err
		}
	}
	info := domain.NewBotInfo(botID, acc.Description, cmds)
	if acc.MenuButtonText != "" || acc.MenuButtonURL != "" {
		m := domain.NewBotMenuButton(acc.MenuButtonText, acc.MenuButtonURL)
		info.MenuButton = &m
	}
	return &info, acc.About, nil
}

// groupBotInfos — channelFull.bot_info: боты-участники группы и их команды
// глазами зрителя; вторым значением — карточки этих ботов для вектора users.
// Всегда не nil: у группы без ботов, как и у канала-вещания, это пустой вектор.
func (i *Interactor) groupBotInfos(ctx context.Context, c domain.ChatRecord, viewerID int64) ([]domain.BotInfo, []domain.UserReal) {
	infos := []domain.BotInfo{}
	if i.bots == nil || c.Type != domain.ChatTypeGroup {
		return infos, nil
	}
	ids, err := i.bots.ChatBotIDs(ctx, c.ID, botInfosLimit)
	if err != nil {
		log.Printf("bot_info: chat=%d: боты чата: %v", c.ID, err)
		return infos, nil
	}
	if len(ids) == 0 {
		return infos, nil
	}
	isAdmin := c.MyRole == domain.RoleCreator || c.MyRole == domain.RoleAdmin
	cmds, err := i.bots.CommandsForBots(ctx, ids, c.ID, viewerID, isAdmin, "")
	if err != nil {
		log.Printf("bot_info: chat=%d: команды ботов: %v", c.ID, err)
		return infos, nil
	}
	for _, id := range ids {
		infos = append(infos, domain.NewBotInfo(id, "", cmds[id]))
	}
	if i.groups == nil {
		return infos, nil
	}
	cards, err := i.groups.UsersByIDs(ctx, viewerID, ids)
	if err != nil {
		log.Printf("bot_info: chat=%d: карточки ботов: %v", c.ID, err)
		return infos, nil
	}
	i.viewUsers(ctx, viewerID, cards)
	return infos, cards
}
