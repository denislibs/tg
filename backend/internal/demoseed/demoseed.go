// Package demoseed наполняет дев-стенд демо-контентом: тематические каналы с
// постами, группа обсуждения с комментариями к постам, обычные группы с
// перепиской, опросы, закрепления и реакции.
//
// Всё создаётся ЧЕРЕЗ НАСТОЯЩИЕ методы интерактора чата — теми же вызовами,
// которые делает живой клиент (CreateChannel/CreateGroup/JoinPublic/AddMember/
// LinkDiscussion/Send/PostToChannel/PostComment/SendPoll/SetPin/React). Прямых INSERT'ов в chats/messages
// здесь нет сознательно: только реальный путь порождает служебные сообщения,
// записи журнала updates с pts, веер по участникам и корректную адресацию — а
// проверяют на стенде именно их. Сид, пишущий в таблицы, наполнил бы базу, но
// проверять на ней было бы нечего.
//
// Включается флагом SEED_DEMO. Идемпотентен ПОЕДИНИЧНО: гвардом накрыт не чат
// целиком, а каждая единица содержимого — своим настоящим ключом. Чат —
// названием у автора, привязка обсуждения — полем chats.discussion_chat_id,
// сообщение — ключом идемпотентности отправки (чат + автор + client_msg_id),
// членство — строкой chat_members, закрепление — списком закреплённых.
// Поэтому сид ДОЗАВОДИТ недостающее: чат, заведённый прошлой версией сида,
// получает то, что спека добавила позже, а то, что уже есть, не дублируется.
// Гвард «чат с таким названием у автора есть — пропускаем чат целиком» такого
// не умел: любое пополнение спеки не доезжало до уже засеянного стенда.
package demoseed

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// reactionEmojis — чем демо-подписчики реагируют на посты.
var reactionEmojis = []string{"👍", "❤️", "🔥", "😮", "👏", "🎉"}

// Ключи идемпотентности отправки. Живут одним местом и НЕ МЕНЯЮТСЯ: по ним сид
// узнаёт своё же сообщение на уже засеянном стенде, и переименование ключа
// означало бы «этого сообщения нет» — то есть дубль всей ленты.
func postKey(username string, idx int) string    { return fmt.Sprintf("seed-%s-%d", username, idx) }
func commentKey(username string, idx int) string { return fmt.Sprintf("seed-%s-c%d", username, idx) }
func channelPollKey(username string) string      { return fmt.Sprintf("seed-%s-poll", username) }
func replyKey(gidx, idx int) string              { return fmt.Sprintf("seed-g%d-%d", gidx, idx) }
func groupPollKey(gidx int) string               { return fmt.Sprintf("seed-g%d-poll", gidx) }
func albumFrameKey(base string, i int) string    { return fmt.Sprintf("%s-a%d", base, i) }

// chatAPI — та часть интерактора чата, которой пользуется сид. Сид держит
// интерфейс, а не *usecasechat.Interactor, чтобы его собственные проводки
// (связка канал↔обсуждение, адресация комментариев, идемпотентность повторного
// прогона) проверялись тестом без постгреса.
type chatAPI interface {
	ListDialogs(ctx context.Context, userID int64) ([]domain.DialogRecord, error)
	ChatCard(ctx context.Context, chatID, viewerID int64) (domain.ChatRecord, error)
	MessageByClientMsgID(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error)
	ListPins(ctx context.Context, chatID, userID int64) ([]domain.Message, error)
	CreateChannel(ctx context.Context, creatorID int64, title, about, username string, isPublic bool) (int64, error)
	CreateGroup(ctx context.Context, creatorID int64, title, about, username string, isPublic bool, memberIDs []int64) (int64, error)
	JoinPublic(ctx context.Context, username string, userID int64) error
	AddMember(ctx context.Context, chatID, actorID, userID int64) error
	LinkDiscussion(ctx context.Context, channelID, groupID, actorID int64) (int64, error)
	PostToChannel(ctx context.Context, channelID, actorID int64, text string, entities domain.MessageEntities, clientMsgID string) (domain.Message, error)
	PostComment(ctx context.Context, channelID, postID, userID int64, text, clientMsgID string) (domain.Message, error)
	Send(ctx context.Context, in usecasechat.SendInput) (domain.Message, error)
	SendPoll(ctx context.Context, in usecasechat.SendPollInput) (domain.Message, error)
	VotePoll(ctx context.Context, pollID, userID int64, optionIdxs []int) (domain.PollInfo, error)
	SetPin(ctx context.Context, chatID, msgID, userID int64, pin bool) error
	React(ctx context.Context, chatID, messageID, userID int64, emoji string, add bool) error
}

type seeder struct {
	uc    chatAPI
	media *usecasemedia.Interactor
	users map[string]int64
	// names — юзернеймы в стабильном порядке: обход map недетерминирован, а
	// состав подписчиков и реакций должен воспроизводиться от прогона к прогону.
	names []string
	// dialogs — «пользователь → название чата → id чата»: чаты, уже видимые
	// пользователю. Один список диалогов на пользователя отвечает сразу на два
	// вопроса — «сид уже заводил этот чат» и «этот участник уже в чате».
	dialogs map[int64]map[string]int64
	// photoSeq — сквозной счётчик картинок (у соседних чатов разные заливки).
	photoSeq int
	// groupedSeq — ключ медиагруппы (Telegram grouped_id) для альбомов.
	groupedSeq int64
}

// Seed наполняет стенд демо-контентом. users — карта «юзернейм → id» из
// postgres.SeedDemo; media может быть nil (MinIO недоступен) — тогда посты
// уходят без картинок, а альбомы просто не отправляются.
func Seed(ctx context.Context, uc *usecasechat.Interactor, media *usecasemedia.Interactor, users map[string]int64) {
	// nil проверяется на КОНКРЕТНОМ типе: в интерфейсе chatAPI нулевой
	// указатель перестал бы быть nil.
	if uc == nil || len(users) == 0 {
		return
	}
	seed(ctx, uc, media, users)
}

func seed(ctx context.Context, uc chatAPI, media *usecasemedia.Interactor, users map[string]int64) {
	// groupedSeq стартует с крупного числа: ключ медиагруппы генерирует
	// отправитель, и демо-альбомы не должны пересекаться с клиентскими.
	s := &seeder{uc: uc, media: media, users: users, dialogs: map[int64]map[string]int64{}, groupedSeq: 1 << 40}
	for name := range users {
		s.names = append(s.names, name)
	}
	slices.Sort(s.names)

	posts := 0
	for _, c := range channels {
		posts += s.channel(ctx, c)
	}
	msgs := 0
	for i, g := range groups {
		msgs += s.group(ctx, i, g)
	}
	log.Printf("seed: демо-контент готов (добавлено %d постов в каналах, %d сообщений в группах)", posts, msgs)
}

// chatID — id чата пользователя с таким названием (0 — такого чата у него нет).
// Список диалогов читается один раз на пользователя.
func (s *seeder) chatID(ctx context.Context, userID int64, title string) int64 {
	set, ok := s.dialogs[userID]
	if !ok {
		set = map[string]int64{}
		dialogs, err := s.uc.ListDialogs(ctx, userID)
		if err != nil {
			log.Printf("seed: диалоги %d не прочитаны: %v", userID, err)
		}
		for _, d := range dialogs {
			set[d.Title] = d.ChatID
		}
		s.dialogs[userID] = set
	}
	return set[title]
}

// mark отмечает чат видимым пользователю. Незагруженный список не трогаем: в
// нём отсутствие названия значит «чата нет», и половинчатый список соврал бы
// про все остальные чаты этого пользователя.
func (s *seeder) mark(userID int64, title string, chatID int64) {
	if set, ok := s.dialogs[userID]; ok {
		set[title] = chatID
	}
}

// sent — сообщение, которое сид уже отправлял под этим ключом идемпотентности
// (чат + автор + client_msg_id); ok == false, если такого сообщения ещё нет.
// Спрашиваем ДО отправки, а не полагаемся на дедуп внутри Send: подготовка
// отправки стоит денег (заливка картинки в MinIO, создание строки опроса), и
// на повторном прогоне эта плата взималась бы каждый раз.
func (s *seeder) sent(ctx context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, bool) {
	m, err := s.uc.MessageByClientMsgID(ctx, chatID, senderID, clientMsgID)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) {
			log.Printf("seed: сообщение %s не проверено: %v", clientMsgID, err)
		}
		return domain.Message{}, false
	}
	return m, true
}

// addMember зовёт в чат того, кого в нём ещё нет. Проверка обязательна:
// AddMember кладёт в ленту служебную пилюлю при КАЖДОМ вызове, а не только
// когда участник действительно добавился. Отвечает, состоит ли он в чате после
// вызова.
func (s *seeder) addMember(ctx context.Context, chatID, actorID, userID int64, name, title string) bool {
	if s.chatID(ctx, userID, title) != 0 {
		return true
	}
	if err := s.uc.AddMember(ctx, chatID, actorID, userID); err != nil {
		log.Printf("seed: @%s не добавлен в %q: %v", name, title, err)
		return false
	}
	s.mark(userID, title, chatID)
	return true
}

// pin закрепляет сообщение, если оно ещё не закреплено. Проверка обязательна по
// той же причине, что и у addMember: закрепление оставляет в ленте служебную
// пилюлю (messageActionPinMessage) на каждый вызов SetPin.
func (s *seeder) pin(ctx context.Context, chatID, msgID, userID int64, title string) {
	if msgID == 0 {
		return
	}
	pins, err := s.uc.ListPins(ctx, chatID, userID)
	if err != nil {
		log.Printf("seed: закрепления %q не прочитаны: %v", title, err)
		return
	}
	for _, m := range pins {
		if m.ID == msgID {
			return
		}
	}
	if err := s.uc.SetPin(ctx, chatID, msgID, userID, true); err != nil {
		log.Printf("seed: закрепление в %q не удалось: %v", title, err)
	}
}

// ── Каналы ──────────────────────────────────────────────────────────────────

func (s *seeder) channel(ctx context.Context, c channelSpec) int {
	creator := s.users[c.creator]
	if creator == 0 {
		log.Printf("seed: канал %q пропущен — нет автора @%s", c.title, c.creator)
		return 0
	}
	chatID := s.chatID(ctx, creator, c.title)
	newChat := chatID == 0
	if newChat {
		id, err := s.uc.CreateChannel(ctx, creator, c.title, c.about, c.username, true)
		if err != nil {
			log.Printf("seed: канал %q не создан: %v", c.title, err)
			return 0
		}
		chatID = id
		s.mark(creator, c.title, chatID)
	}
	// Обсуждение привязывается ДО постов: зеркало поста в группе обсуждения
	// (корень треда комментариев) рождается на вставке самого поста и только
	// если привязка уже есть. У постов, опубликованных РАНЬШЕ привязки (канал
	// завела версия сида, ещё не знавшая про обсуждение), зеркала нет — его
	// дозаводит первый комментарий (lazyMirrorPost), поэтому футер комментариев
	// появится только под прокомментированными постами, а не под всеми.
	discID := s.discussion(ctx, chatID, creator, c)

	subs := make([]int64, 0, len(s.names))
	for _, name := range s.names {
		uid := s.users[name]
		if uid == creator {
			continue
		}
		if s.chatID(ctx, uid, c.title) == 0 {
			// Подписка идёт публичным путём — по юзернейму, ровно как из поиска.
			if err := s.uc.JoinPublic(ctx, c.username, uid); err != nil {
				log.Printf("seed: @%s не подписан на %q: %v", name, c.title, err)
				continue
			}
			s.mark(uid, c.title, chatID)
		}
		subs = append(subs, uid)
	}

	// postIDs адресуется ИНДЕКСОМ ПОСТА в спеке: комментарии спеки ссылаются на
	// посты по этому индексу, и сорвавшаяся отправка не имеет права сдвинуть
	// адресацию.
	postIDs := make([]int64, len(c.posts))
	todo := make([]int, 0, len(c.posts))
	needPhotos := false
	for idx, p := range c.posts {
		if m, ok := s.sent(ctx, chatID, creator, postKey(c.username, idx)); ok {
			postIDs[idx] = m.ID
			continue
		}
		todo = append(todo, idx)
		needPhotos = needPhotos || p.photo >= 0
	}
	// Картинки заливаются, только если они нужны недостающим постам: заливка на
	// каждом прогоне копила бы в MinIO по набору на канал.
	var pics []int64
	if needPhotos {
		pics = s.uploadPhotos(ctx, creator, c.photos)
	}
	added := make([]int64, 0, len(todo))
	for _, idx := range todo {
		p := c.posts[idx]
		text, ents := compose(p.body)
		cmid := postKey(c.username, idx)
		var msg domain.Message
		var err error
		if p.photo >= 0 && p.photo < len(pics) {
			// Медиа в канал уходит общим путём отправки — ровно как из клиента:
			// у поста канала (PostToChannel) вложения нет по контракту, и веб
			// шлёт фото обычным send_message. Следствие тоже клиентское: такой
			// пост едет пер-юзерным веером, а не через channel_pts.
			msg, err = s.uc.Send(ctx, usecasechat.SendInput{
				ChatID: chatID, SenderID: creator, Type: "photo",
				Text: text, Entities: ents, MediaID: &pics[p.photo], ClientMsgID: cmid,
			})
		} else {
			msg, err = s.uc.PostToChannel(ctx, chatID, creator, text, ents, cmid)
		}
		if err != nil {
			log.Printf("seed: пост %d канала %q не отправлен: %v", idx, c.title, err)
			continue
		}
		postIDs[idx] = msg.ID
		added = append(added, msg.ID)
	}
	if c.pinIndex >= 0 && c.pinIndex < len(postIDs) {
		s.pin(ctx, chatID, postIDs[c.pinIndex], creator, c.title)
	}
	comments := s.comments(ctx, chatID, discID, c, postIDs)
	if newChat {
		// Опрос уезжает только в ТОЛЬКО ЧТО заведённый канал: у опросов,
		// отправленных ранними версиями сида, ключа идемпотентности нет вовсе
		// (ClientMsgID им тогда не проставляли), и на уже существующем чате
		// «опроса нет» от «опрос уже стоит» не отличить. Ключ теперь
		// проставляется — повторную отправку в тот же чат отсечёт сам Send.
		s.sendPoll(ctx, chatID, creator, channelPollKey(c.username), c.poll, subs)
	}
	s.react(ctx, chatID, added, subs)
	log.Printf("seed: канал %q — добавлено %d постов и %d комментариев, %d подписчиков",
		c.title, len(added), comments, len(subs))
	return len(added)
}

// discussion заводит группу обсуждения канала и привязывает её ТЕМ ЖЕ путём,
// что и клиент: обычная группа (CreateGroup) плюс LinkDiscussion — аналог
// channels.setDiscussionGroup, за которым стоит PUT /channels/{id}/discussion.
// EnableDiscussion тут не годится: он создаёт группу сам и с несменяемым
// названием "Discussion", а демо-стенду нужна группа с человеческим именем.
// Возвращает id привязанной группы (0 — обсуждения у канала нет и не будет).
func (s *seeder) discussion(ctx context.Context, channelID, creator int64, c channelSpec) int64 {
	if c.discussion == nil {
		return 0
	}
	// Ключ идемпотентности привязки — само поле chats.discussion_chat_id, а не
	// наличие группы с таким названием: канал мог быть заведён прогоном, ещё не
	// знавшим про обсуждение, и тогда группы нет, а привязывать надо.
	if card, err := s.uc.ChatCard(ctx, channelID, creator); err != nil {
		log.Printf("seed: карточка канала %q не прочитана: %v", c.title, err)
		return 0
	} else if card.DiscussionChatID != 0 {
		return card.DiscussionChatID
	}
	groupID := s.chatID(ctx, creator, c.discussion.title)
	if groupID == 0 {
		// Участников группе не раздаём: комментатора подписывает на обсуждение
		// сам PostComment (auto-join), как и у живого клиента.
		id, err := s.uc.CreateGroup(ctx, creator, c.discussion.title, c.discussion.about, "", false, nil)
		if err != nil {
			log.Printf("seed: группа обсуждения для %q не создана: %v", c.title, err)
			return 0
		}
		groupID = id
		s.mark(creator, c.discussion.title, groupID)
	}
	if _, err := s.uc.LinkDiscussion(ctx, channelID, groupID, creator); err != nil {
		log.Printf("seed: обсуждение не привязано к %q: %v", c.title, err)
		return 0
	}
	return groupID
}

// comments наполняет треды постов канала. Комментарий уходит штатным
// PostComment: он сам резолвит зеркало поста в группе обсуждения, подписывает
// автора на неё и тредит комментарий на зеркало — руками адресовать тред сид
// не имеет права, иначе разъедется с живым клиентом.
func (s *seeder) comments(ctx context.Context, channelID, discID int64, c channelSpec, postIDs []int64) int {
	if c.discussion == nil || discID == 0 {
		return 0
	}
	n := 0
	for idx, cm := range c.discussion.comments {
		if cm.post < 0 || cm.post >= len(postIDs) || postIDs[cm.post] == 0 {
			log.Printf("seed: комментарий %d канала %q без поста", idx, c.title)
			continue
		}
		author := s.users[cm.author]
		if author == 0 {
			log.Printf("seed: комментарий %d канала %q пропущен — нет автора @%s", idx, c.title, cm.author)
			continue
		}
		// Комментарий физически лежит в ГРУППЕ ОБСУЖДЕНИЯ — там же его и ищем:
		// ключ идемпотентности отправки считается по чату-получателю.
		key := commentKey(c.username, idx)
		if _, ok := s.sent(ctx, discID, author, key); ok {
			continue
		}
		if _, err := s.uc.PostComment(ctx, channelID, postIDs[cm.post], author, cm.text, key); err != nil {
			log.Printf("seed: комментарий %d канала %q не отправлен: %v", idx, c.title, err)
			continue
		}
		n++
	}
	return n
}

// ── Группы ──────────────────────────────────────────────────────────────────

func (s *seeder) group(ctx context.Context, gidx int, g groupSpec) int {
	creator := s.users[g.creator]
	if creator == 0 {
		log.Printf("seed: группа %q пропущена — нет автора @%s", g.title, g.creator)
		return 0
	}
	chatID := s.chatID(ctx, creator, g.title)
	newChat := chatID == 0
	members := make([]int64, 0, len(g.members)+1)
	if newChat {
		for _, name := range g.members {
			if uid := s.users[name]; uid != 0 {
				members = append(members, uid)
			}
		}
		id, err := s.uc.CreateGroup(ctx, creator, g.title, g.about, "", false, members)
		if err != nil {
			log.Printf("seed: группа %q не создана: %v", g.title, err)
			return 0
		}
		chatID = id
		s.mark(creator, g.title, chatID)
		for _, uid := range members {
			s.mark(uid, g.title, chatID)
		}
	} else {
		// Состав существующей группы догоняет спеку: кого в ней ещё нет,
		// приходит обычным приглашением со своей служебной пилюлей.
		for _, name := range g.members {
			uid := s.users[name]
			if uid == 0 {
				continue
			}
			if s.addMember(ctx, chatID, creator, uid, name, g.title) {
				members = append(members, uid)
			}
		}
	}
	members = append(members, creator)

	// Опоздавших зовут в середине переписки — каждый такой вызов оставляет в
	// ленте свою служебную пилюлю.
	lateAt := len(g.script) / 2
	seqs := make([]int64, len(g.script))
	ids := make([]int64, len(g.script))
	added := make([]int64, 0, len(g.script))
	for idx, r := range g.script {
		if idx == lateAt {
			for _, name := range g.lateJoin {
				uid := s.users[name]
				if uid == 0 {
					continue
				}
				if s.addMember(ctx, chatID, creator, uid, name, g.title) {
					members = append(members, uid)
				}
			}
		}
		author := s.users[r.author]
		if author == 0 {
			continue
		}
		cmid := replyKey(gidx, idx)
		// У альбома ключ первого кадра: он же и голова медиагруппы.
		key := cmid
		if r.album > 0 {
			key = albumFrameKey(cmid, 0)
		}
		if m, ok := s.sent(ctx, chatID, author, key); ok {
			seqs[idx] = m.Seq
			ids[idx] = m.ID
			continue
		}
		text, ents := compose(r.body)
		var replyTo *int64
		if r.replyTo >= 0 && r.replyTo < idx && seqs[r.replyTo] != 0 {
			replyTo = &seqs[r.replyTo]
		}
		in := usecasechat.SendInput{
			ChatID: chatID, SenderID: author, Text: text, Entities: ents,
			ReplyToID: replyTo, ClientMsgID: cmid,
		}
		if r.album > 0 {
			album := s.sendAlbum(ctx, r.album, in)
			if len(album) == 0 {
				continue
			}
			seqs[idx] = album[0].Seq
			ids[idx] = album[0].ID
			for _, m := range album {
				added = append(added, m.ID)
			}
			continue
		}
		msg, err := s.uc.Send(ctx, in)
		if err != nil {
			log.Printf("seed: реплика %d в %q не отправлена: %v", idx, g.title, err)
			continue
		}
		seqs[idx] = msg.Seq
		ids[idx] = msg.ID
		added = append(added, msg.ID)
	}
	if g.pinIndex >= 0 && g.pinIndex < len(ids) {
		s.pin(ctx, chatID, ids[g.pinIndex], creator, g.title)
	}
	if newChat {
		// Про «только в новый чат» — см. тот же комментарий в channel().
		s.sendPoll(ctx, chatID, creator, groupPollKey(gidx), g.poll, members)
	}
	s.react(ctx, chatID, added, members)
	log.Printf("seed: группа %q — добавлено %d сообщений, %d участников", g.title, len(added), len(members))
	return len(added)
}

// sendAlbum отправляет медиагруппу (Telegram grouped_id): несколько фото с
// общим ключом группы, подпись — только на первом кадре. Картинки заводятся на
// автора реплики: чужое медиа отправка не пропустит.
func (s *seeder) sendAlbum(ctx context.Context, n int, base usecasechat.SendInput) []domain.Message {
	pics := s.uploadPhotos(ctx, base.SenderID, n)
	if len(pics) == 0 {
		return nil
	}
	s.groupedSeq++
	out := make([]domain.Message, 0, len(pics))
	for i := range pics {
		in := base
		in.Type = "photo"
		in.MediaID = &pics[i]
		in.GroupedID = s.groupedSeq
		in.ClientMsgID = albumFrameKey(base.ClientMsgID, i)
		if i > 0 {
			in.Text, in.Entities = "", nil
		}
		msg, err := s.uc.Send(ctx, in)
		if err != nil {
			log.Printf("seed: кадр альбома не отправлен: %v", err)
			return out
		}
		out = append(out, msg)
	}
	return out
}

// ── Опросы, реакции, картинки ───────────────────────────────────────────────

func (s *seeder) sendPoll(ctx context.Context, chatID, authorID int64, key string, spec *pollSpec, voters []int64) {
	if spec == nil || len(spec.options) < 2 {
		return
	}
	in := usecasechat.SendPollInput{
		ChatID: chatID, SenderID: authorID,
		Question: spec.question, Options: spec.options,
		Anonymous: true, Quiz: spec.quiz, ClientMsgID: key,
	}
	if spec.quiz {
		correct := spec.correct
		in.CorrectOption = &correct
	}
	msg, err := s.uc.SendPoll(ctx, in)
	if err != nil {
		log.Printf("seed: опрос не отправлен: %v", err)
		return
	}
	if msg.PollID == nil {
		return
	}
	voted := 0
	for i, uid := range voters {
		if voted >= 8 {
			break
		}
		if uid == authorID {
			continue
		}
		if _, err := s.uc.VotePoll(ctx, *msg.PollID, uid, []int{i % len(spec.options)}); err != nil {
			log.Printf("seed: голос в опросе не учтён: %v", err)
			continue
		}
		voted++
	}
}

// react расставляет реакции на каждое пятое сообщение — чтобы в ленте были и
// баблы с реакциями, и баблы без них. Навешивает их ТОЛЬКО на отправленное этим
// прогоном: своего ключа идемпотентности у реакции нет, а повторный React с тем
// же эмодзи, будучи no-op по самой реакции, каждый раз бампит счётчик
// непрочитанных реакций автора сообщения.
func (s *seeder) react(ctx context.Context, chatID int64, msgIDs []int64, users []int64) {
	if len(users) == 0 {
		return
	}
	for i, msgID := range msgIDs {
		if i%5 != 0 {
			continue
		}
		for k := 0; k <= i%3; k++ {
			uid := users[(i+k*3)%len(users)]
			emoji := reactionEmojis[(i+k)%len(reactionEmojis)]
			if err := s.uc.React(ctx, chatID, msgID, uid, emoji, true); err != nil {
				log.Printf("seed: реакция не поставлена: %v", err)
			}
		}
	}
}

// uploadPhotos кладёт n нарисованных картинок тем же путём, что и клиентский
// аплоад: строка media + объект в MinIO, размеры и blur_preview досчитывает
// фоновая обработка медиа-usecase.
func (s *seeder) uploadPhotos(ctx context.Context, ownerID int64, n int) []int64 {
	if s.media == nil || n <= 0 {
		return nil
	}
	out := make([]int64, 0, n)
	for i := 0; i < n; i++ {
		seq := s.photoSeq
		s.photoSeq++
		data, w, h, err := drawPhoto(seq)
		if err != nil {
			log.Printf("seed: картинка не нарисована: %v", err)
			return out
		}
		m, _, err := s.media.CreateUpload(ctx, usecasemedia.UploadInput{
			OwnerID: ownerID, Mime: "image/jpeg", Size: int64(len(data)),
			Width: w, Height: h, FileName: fmt.Sprintf("demo-%d.jpg", seq),
		})
		if err != nil {
			log.Printf("seed: медиа не заведено: %v", err)
			return out
		}
		if err := s.media.PutContent(ctx, m.ID, ownerID, bytes.NewReader(data), int64(len(data))); err != nil {
			log.Printf("seed: байты медиа не загружены: %v", err)
			return out
		}
		out = append(out, m.ID)
	}
	return out
}
