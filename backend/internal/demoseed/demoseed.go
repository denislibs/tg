// Package demoseed наполняет дев-стенд демо-контентом: тематические каналы с
// постами, обычные группы с перепиской, опросы, закрепления и реакции.
//
// Всё создаётся ЧЕРЕЗ НАСТОЯЩИЕ методы интерактора чата — теми же вызовами,
// которые делает живой клиент (CreateChannel/CreateGroup/JoinPublic/AddMember/
// Send/PostToChannel/SendPoll/SetPin/React). Прямых INSERT'ов в chats/messages
// здесь нет сознательно: только реальный путь порождает служебные сообщения,
// записи журнала updates с pts, веер по участникам и корректную адресацию — а
// проверяют на стенде именно их. Сид, пишущий в таблицы, наполнил бы базу, но
// проверять на ней было бы нечего.
//
// Включается флагом SEED_DEMO; идемпотентен — чат, который уже есть у своего
// автора, пропускается целиком вместе со своим содержимым.
package demoseed

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"slices"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// reactionEmojis — чем демо-подписчики реагируют на посты.
var reactionEmojis = []string{"👍", "❤️", "🔥", "😮", "👏", "🎉"}

type seeder struct {
	uc    *usecasechat.Interactor
	media *usecasemedia.Interactor
	users map[string]int64
	// names — юзернеймы в стабильном порядке: обход map недетерминирован, а
	// состав подписчиков и реакций должен воспроизводиться от прогона к прогону.
	names []string
	// owned — названия чатов, уже существующих у автора: ключ идемпотентности.
	owned map[int64]map[string]bool
	// photoSeq — сквозной счётчик картинок (у соседних чатов разные заливки).
	photoSeq int
	// groupedSeq — ключ медиагруппы (Telegram grouped_id) для альбомов.
	groupedSeq int64
}

// Seed наполняет стенд демо-контентом. users — карта «юзернейм → id» из
// postgres.SeedDemo; media может быть nil (MinIO недоступен) — тогда посты
// уходят без картинок, а альбомы просто не отправляются.
func Seed(ctx context.Context, uc *usecasechat.Interactor, media *usecasemedia.Interactor, users map[string]int64) {
	if uc == nil || len(users) == 0 {
		return
	}
	// groupedSeq стартует с крупного числа: ключ медиагруппы генерирует
	// отправитель, и демо-альбомы не должны пересекаться с клиентскими.
	s := &seeder{uc: uc, media: media, users: users, owned: map[int64]map[string]bool{}, groupedSeq: 1 << 40}
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
	log.Printf("seed: демо-контент готов (%d постов в каналах, %d сообщений в группах)", posts, msgs)
}

// hasChat отвечает, есть ли уже у автора чат с таким названием. Список диалогов
// читается один раз на автора — это и есть проверка «сид уже отработал».
func (s *seeder) hasChat(ctx context.Context, ownerID int64, title string) bool {
	set, ok := s.owned[ownerID]
	if !ok {
		set = map[string]bool{}
		dialogs, err := s.uc.ListDialogs(ctx, ownerID)
		if err != nil {
			log.Printf("seed: диалоги %d не прочитаны: %v", ownerID, err)
		}
		for _, d := range dialogs {
			set[d.Title] = true
		}
		s.owned[ownerID] = set
	}
	return set[title]
}

func (s *seeder) mark(ownerID int64, title string) {
	if set, ok := s.owned[ownerID]; ok {
		set[title] = true
	}
}

// ── Каналы ──────────────────────────────────────────────────────────────────

func (s *seeder) channel(ctx context.Context, c channelSpec) int {
	creator := s.users[c.creator]
	if creator == 0 {
		log.Printf("seed: канал %q пропущен — нет автора @%s", c.title, c.creator)
		return 0
	}
	if s.hasChat(ctx, creator, c.title) {
		return 0
	}
	chatID, err := s.uc.CreateChannel(ctx, creator, c.title, c.about, c.username, true)
	if err != nil {
		log.Printf("seed: канал %q не создан: %v", c.title, err)
		return 0
	}
	s.mark(creator, c.title)

	// Подписка идёт публичным путём — по юзернейму, ровно как из поиска.
	subs := make([]int64, 0, len(s.names))
	for _, name := range s.names {
		uid := s.users[name]
		if uid == creator {
			continue
		}
		if err := s.uc.JoinPublic(ctx, c.username, uid); err != nil {
			log.Printf("seed: @%s не подписан на %q: %v", name, c.title, err)
			continue
		}
		subs = append(subs, uid)
	}

	pics := s.uploadPhotos(ctx, creator, c.photos)
	msgIDs := make([]int64, 0, len(c.posts))
	var pinID int64
	for idx, p := range c.posts {
		text, ents := compose(p.body)
		cmid := fmt.Sprintf("seed-%s-%d", c.username, idx)
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
		msgIDs = append(msgIDs, msg.ID)
		if idx == c.pinIndex {
			pinID = msg.ID
		}
	}
	if pinID != 0 {
		if err := s.uc.SetPin(ctx, chatID, pinID, creator, true); err != nil {
			log.Printf("seed: закрепление в %q не удалось: %v", c.title, err)
		}
	}
	s.sendPoll(ctx, chatID, creator, c.poll, subs)
	s.react(ctx, chatID, msgIDs, subs)
	log.Printf("seed: канал %q — %d постов, %d подписчиков", c.title, len(msgIDs), len(subs))
	return len(msgIDs)
}

// ── Группы ──────────────────────────────────────────────────────────────────

func (s *seeder) group(ctx context.Context, gidx int, g groupSpec) int {
	creator := s.users[g.creator]
	if creator == 0 {
		log.Printf("seed: группа %q пропущена — нет автора @%s", g.title, g.creator)
		return 0
	}
	if s.hasChat(ctx, creator, g.title) {
		return 0
	}
	members := make([]int64, 0, len(g.members)+1)
	for _, name := range g.members {
		if uid := s.users[name]; uid != 0 {
			members = append(members, uid)
		}
	}
	chatID, err := s.uc.CreateGroup(ctx, creator, g.title, g.about, "", false, members)
	if err != nil {
		log.Printf("seed: группа %q не создана: %v", g.title, err)
		return 0
	}
	s.mark(creator, g.title)
	members = append(members, creator)

	// Опоздавших зовут в середине переписки — каждый такой вызов оставляет в
	// ленте свою служебную пилюлю.
	lateAt := len(g.script) / 2
	seqs := make([]int64, len(g.script))
	msgIDs := make([]int64, 0, len(g.script))
	var pinID int64
	for idx, r := range g.script {
		if idx == lateAt {
			for _, name := range g.lateJoin {
				uid := s.users[name]
				if uid == 0 {
					continue
				}
				if err := s.uc.AddMember(ctx, chatID, creator, uid); err != nil {
					log.Printf("seed: @%s не добавлен в %q: %v", name, g.title, err)
					continue
				}
				members = append(members, uid)
			}
		}
		author := s.users[r.author]
		if author == 0 {
			continue
		}
		text, ents := compose(r.body)
		var replyTo *int64
		if r.replyTo >= 0 && r.replyTo < idx && seqs[r.replyTo] != 0 {
			replyTo = &seqs[r.replyTo]
		}
		in := usecasechat.SendInput{
			ChatID: chatID, SenderID: author, Text: text, Entities: ents,
			ReplyToID: replyTo, ClientMsgID: fmt.Sprintf("seed-g%d-%d", gidx, idx),
		}
		if r.album > 0 {
			album := s.sendAlbum(ctx, r.album, in)
			if len(album) == 0 {
				continue
			}
			seqs[idx] = album[0].Seq
			for _, m := range album {
				msgIDs = append(msgIDs, m.ID)
			}
			if idx == g.pinIndex {
				pinID = album[0].ID
			}
			continue
		}
		msg, err := s.uc.Send(ctx, in)
		if err != nil {
			log.Printf("seed: реплика %d в %q не отправлена: %v", idx, g.title, err)
			continue
		}
		seqs[idx] = msg.Seq
		msgIDs = append(msgIDs, msg.ID)
		if idx == g.pinIndex {
			pinID = msg.ID
		}
	}
	if pinID != 0 {
		if err := s.uc.SetPin(ctx, chatID, pinID, creator, true); err != nil {
			log.Printf("seed: закрепление в %q не удалось: %v", g.title, err)
		}
	}
	s.sendPoll(ctx, chatID, creator, g.poll, members)
	s.react(ctx, chatID, msgIDs, members)
	log.Printf("seed: группа %q — %d сообщений, %d участников", g.title, len(msgIDs), len(members))
	return len(msgIDs)
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
		in.ClientMsgID = fmt.Sprintf("%s-a%d", base.ClientMsgID, i)
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

func (s *seeder) sendPoll(ctx context.Context, chatID, authorID int64, spec *pollSpec, voters []int64) {
	if spec == nil || len(spec.options) < 2 {
		return
	}
	in := usecasechat.SendPollInput{
		ChatID: chatID, SenderID: authorID,
		Question: spec.question, Options: spec.options,
		Anonymous: true, Quiz: spec.quiz,
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
// баблы с реакциями, и баблы без них.
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
