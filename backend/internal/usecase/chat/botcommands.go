package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"slices"
	"sort"
	"sync"
	"time"
	"unicode/utf8"

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
	if err := checkCommandLang(lang); err != nil {
		return err
	}
	// Участие пользователя при снятии записи chat_member не проверяется: вышедший
	// из группы пользователь иначе оставил бы запись навсегда.
	if err := i.checkCommandScope(ctx, bot.BotID, scope, false); err != nil {
		return err
	}
	changed, err := i.botAPI.DeleteCommands(ctx, bot.BotID, scope, lang)
	if err != nil {
		return err
	}
	if changed {
		i.botCommandsChanged(bot.BotID, scope, lang)
	}
	return nil
}

// BotGetCommands читает команды бота для скоупа/языка (getMyCommands).
func (i *Interactor) BotGetCommands(ctx context.Context, bot domain.BotAccount, scope domain.BotCommandScope, lang string) ([]domain.BotCommand, error) {
	if !scope.Valid() {
		return nil, domain.ErrInvalid
	}
	if err := checkCommandLang(lang); err != nil {
		return nil, err
	}
	return i.botAPI.CommandsScoped(ctx, bot.BotID, scope, lang)
}

// setBotCommands — единственный путь записи списка: и Bot API, и мастер
// /setcommands у BotFather идут сюда, поэтому оба рассылают updateBotCommands.
func (i *Interactor) setBotCommands(ctx context.Context, botID int64, scope domain.BotCommandScope, lang string, cmds []domain.BotCommand) error {
	if err := checkBotCommands(cmds); err != nil {
		return err
	}
	if err := checkCommandLang(lang); err != nil {
		return err
	}
	if err := i.checkCommandScope(ctx, botID, scope, true); err != nil {
		return err
	}
	changed, err := i.botAPI.SetCommands(ctx, botID, scope, lang, cmds)
	if err != nil {
		return err
	}
	if changed {
		i.botCommandsChanged(botID, scope, lang)
	}
	return nil
}

// Правила Bot API для списка команд: имя 1-32 символа из [a-z0-9_], описание до
// 256 символов (пустое BotFather тоже принимает), не больше 100 команд, имена
// не повторяются (повтор нарушил бы первичный ключ таблицы).
var botCommandName = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)

func checkBotCommands(cmds []domain.BotCommand) error {
	if len(cmds) > botCommandsMax {
		return domain.ErrInvalid
	}
	seen := make(map[string]bool, len(cmds))
	for _, c := range cmds {
		if !botCommandName.MatchString(c.Command) || seen[c.Command] || utf8.RuneCountInString(c.Description) > 256 {
			return domain.ErrInvalid
		}
		seen[c.Command] = true
	}
	return nil
}

// checkCommandLang: language_code — пустой или двухбуквенный ISO 639-1 в нижнем регистре.
var botLangCode = regexp.MustCompile(`^[a-z]{2}$`)

func checkCommandLang(lang string) error {
	if lang != "" && !botLangCode.MatchString(lang) {
		return domain.ErrInvalid
	}
	return nil
}

// checkCommandScope: тип известен, адрес на месте (domain.BotCommandScope.Valid),
// а адресный скоуп указывает на группу, где состоит бот. Скоуп `chat` личного
// чата не поддерживается: в личке действуют только all_private_chats и default.
func (i *Interactor) checkCommandScope(ctx context.Context, botID int64, scope domain.BotCommandScope, requireUser bool) error {
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
	if scope.UserID != 0 && requireUser {
		if ok, err = i.chats.IsMember(ctx, scope.ChatID, scope.UserID); err != nil {
			return err
		} else if !ok {
			return domain.ErrInvalid
		}
	}
	return nil
}

// botFanoutRuns — идущие рассылки updateBotCommands по ботам. Рассылка одна на
// бота: пока она идёт, новое изменение встаёт в очередь (различные скоупы), и по
// завершении каждый проходится по свежему состоянию. Без этого
// две параллельные рассылки читали бы список в одном порядке, а писали журнал в
// другом, и у части получателей последней оставалась бы устаревшая подсказка.
//
// Реплика одна: замок и очередь живут в памяти процесса. Запись списка при любом
// числе реплик защищена advisory-замком в БД, а вот порядок рассылок двух
// реплик одного бота не гарантирован — у него при нескольких репликах пришлось
// бы брать межпроцессный замок на проход.
type botFanoutRuns struct {
	mu   sync.Mutex
	runs map[int64]*botFanoutRun
}

type botFanoutRun struct {
	pending []domain.BotCommandScope // различные скоупы, пришедшие за время прохода
}

// botFanoutPendingMax — сколько различных скоупов копится за проход; сверх —
// один полный пересчёт (botScopeAll), который никого не пропускает.
const botFanoutPendingMax = 64

// botScopeAll — внутренний «скоуп»: пересчитать у всех и ничего не пропускать
// (ни владельцев chat_member, ни победивших скоупов). Наружу не выходит.
const botScopeAll = "all"

// botCommandsChanged — единая точка после смены списка команд: updateBotCommands
// всем, чья подсказка могла поменяться. Зовётся ПОСЛЕ коммита записи и только
// при реальном изменении; рассылка идёт в фоне (BotFather зовёт её из Send
// пользователя, и ack сообщения не должен ждать тысячи пачек), ошибку только
// логирует — ответ Bot API остаётся успешным.
//
// lang != "": язык зрителя у нас всегда пустой (колонки языка в users нет), и
// список для конкретного языка пользователям не виден, — рассылать нечего.
// scope сужает адресатов (см. fanoutBotCommands). Изменения, пришедшие за время
// прохода, проходятся отдельно каждое по своему скоупу — склеивать разные скоупы
// нельзя: сужение у них разное, а запись chat_member одного пользователя не
// покрывается ни одним общим проходом.
func (i *Interactor) botCommandsChanged(botID int64, scope domain.BotCommandScope, lang string) {
	if lang != "" || i.bots == nil || i.updates == nil {
		return
	}
	runs := &i.botFanouts
	runs.mu.Lock()
	if r, ok := runs.runs[botID]; ok {
		switch {
		case slices.Contains(r.pending, scope):
		case len(r.pending) >= botFanoutPendingMax:
			r.pending = []domain.BotCommandScope{{Type: botScopeAll}}
		default:
			r.pending = append(r.pending, scope)
		}
		runs.mu.Unlock()
		return
	}
	if runs.runs == nil {
		runs.runs = map[int64]*botFanoutRun{}
	}
	r := &botFanoutRun{}
	runs.runs[botID] = r
	runs.mu.Unlock()

	i.goBG("bot_commands_fanout", func(context.Context) {
		// Запись снимается при любом выходе, и при панике (её гасит goBG): иначе
		// бот навсегда остался бы «в рассылке» и новые изменения только копились.
		defer func() {
			runs.mu.Lock()
			if runs.runs[botID] == r {
				delete(runs.runs, botID)
			}
			runs.mu.Unlock()
		}()
		todo := []domain.BotCommandScope{scope}
		for {
			for _, sc := range todo {
				ctx, cancel := context.WithTimeout(context.Background(), botCommandsFanoutTimeout)
				if err := i.fanoutBotCommands(ctx, botID, sc); err != nil {
					log.Printf("bot_commands: fanout bot=%d: %v", botID, err)
				}
				cancel()
			}
			// «Пусто — выйти» и снятие записи под одним замком: изменение, пришедшее
			// между проверкой и выходом, начало бы новый проход, а не легло в очередь
			// уже завершённого.
			runs.mu.Lock()
			if len(r.pending) == 0 {
				delete(runs.runs, botID)
				runs.mu.Unlock()
				return
			}
			todo, r.pending = r.pending, nil
			runs.mu.Unlock()
		}
	})
}

// commandBatch — получатели с одинаковым телом кадра.
type commandBatch struct {
	body  map[string]any
	users []int64
}

// fanoutBotCommands рассылает updateBotCommands тем, чья подсказка могла
// поменяться из-за изменения скоупа scope:
//
//   - default — все лички и группы; all_private_chats — только лички;
//     all_group_chats — только группы;
//   - chat, chat_administrators, chat_member — одна группа; chat_member — один
//     пользователь, *_administrators (и all_chat_administrators) — только админы;
//   - пользователь с собственной записью chat_member изменением других скоупов не
//     затронут — ему кадр не нужен.
//
// Тела: личка — одно на всех; группа — (а) рядовому, (б) админу, (в) пользователю
// с записью chat_member. Выборок команд на все группы бота — одна (GroupLists).
func (i *Interactor) fanoutBotCommands(ctx context.Context, botID int64, scope domain.BotCommandScope) error {
	limit := i.botFanoutLimit()

	var chats []domain.BotChat
	if scope.ChatID != 0 {
		chats = []domain.BotChat{{ChatID: scope.ChatID, Type: domain.ChatTypeGroup}}
	} else {
		var types []string
		if scopeReachesPrivate(scope) {
			types = append(types, domain.ChatTypePrivate)
		}
		if scopeReachesGroups(scope) {
			types = append(types, domain.ChatTypeGroup)
		}
		all, err := i.bots.BotChats(ctx, botID, types, limit+1)
		if err != nil {
			return err
		}
		if len(all) > limit {
			log.Printf("bot_commands: bot=%d: чатов больше предела %d, рассылки нет", botID, limit)
			return nil
		}
		chats = all
	}
	var groupIDs []int64
	chatIDs := make([]int64, 0, len(chats))
	types := make(map[int64]string, len(chats))
	for _, c := range chats {
		if c.Type != domain.ChatTypePrivate && c.Type != domain.ChatTypeGroup {
			continue // broadcast-каналы команд не показывают
		}
		chatIDs = append(chatIDs, c.ChatID)
		types[c.ChatID] = c.Type
		if c.Type == domain.ChatTypeGroup {
			groupIDs = append(groupIDs, c.ChatID)
		}
	}
	if len(chatIDs) == 0 {
		return nil
	}
	n, err := i.bots.CountChatMembers(ctx, chatIDs, botID, limit+1)
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
	lists, err := i.bots.GroupLists(ctx, botID, groupIDs)
	if err != nil {
		return err
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

	all := scope.Type == botScopeAll
	changed := scope.Norm()
	sort.Slice(chatIDs, func(a, b int) bool { return chatIDs[a] < chatIDs[b] })
	for _, chatID := range chatIDs {
		rs := byChat[chatID]
		if len(rs) == 0 {
			continue
		}
		if types[chatID] == domain.ChatTypePrivate {
			cmds, winner := lists.ResolvePrivate()
			// Победил скоуп выше изменившегося — подсказка у лички не поменялась.
			if !all && domain.BotScopeRank(winner, false) < domain.BotScopeRank(changed, false) {
				continue
			}
			for _, r := range rs {
				add("private", domain.NewPeerUser(botID), cmds, r.UserID)
			}
			continue
		}

		peer := domain.NewPeer(domain.ToPeerID(chatID, true))
		member := lists.Member[chatID]
		for _, r := range rs {
			own := member[r.UserID]
			if !all {
				switch changed {
				case domain.BotScopeChatMember:
					if r.UserID != scope.UserID {
						continue
					}
				case domain.BotScopeChatAdministrator, domain.BotScopeAllChatAdmins:
					if !r.Staff {
						continue
					}
				}
			}
			if len(own) > 0 {
				if !all && changed != domain.BotScopeChatMember {
					continue // собственная запись chat_member важнее изменившегося скоупа
				}
				add(fmt.Sprintf("group/%d/member/%d", chatID, r.UserID), peer, own, r.UserID)
				continue
			}
			cmds, winner := lists.ResolveGroup(chatID, r.Staff)
			if !all && domain.BotScopeRank(winner, true) < domain.BotScopeRank(changed, true) {
				continue
			}
			variant := "plain"
			if r.Staff {
				variant = "staff"
			}
			add(fmt.Sprintf("group/%d/%s", chatID, variant), peer, cmds, r.UserID)
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
	// Не «всё или ничего»: сбой пачки не отменяет уже записанные. Пропущенные
	// получатели узнают команды с полной карточкой при следующем открытии.
	return firstErr
}

func scopeReachesPrivate(s domain.BotCommandScope) bool {
	switch s.Norm() {
	case domain.BotScopeDefault, domain.BotScopeAllPrivateChats, botScopeAll:
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
