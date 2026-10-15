package contacts

import (
	"context"
	"errors"
	"log"
	"slices"
	"strings"
	"unicode/utf16"

	"github.com/messenger-denis/backend/internal/domain"
)

// ErrNameRequired is returned when adding a contact without a first name (the
// only required field, mirroring Telegram's "Имя (обязательно)").
var ErrNameRequired = errors.New("first name is required")

// ErrSelfContact is returned when a user tries to add themselves.
var ErrSelfContact = errors.New("cannot add yourself as a contact")

// ErrPhoneRequired — при добавлении по номеру не передан телефон.
var ErrPhoneRequired = errors.New("phone is required")

// ErrCannotAddBot — попытка добавить бота в контакты (Telegram: ботов нельзя
// держать в адресной книге). Хендлер мапит в 400.
var ErrCannotAddBot = errors.New("cannot add a bot as a contact")

// Interactor is the contacts application service.
type Interactor struct {
	repo    ContactsRepo
	privacy PrivacyChecker
	photos  CustomPhotoRepo
	close   CloseFriendsRepo
	media   MediaReader
	emit    SnapshotEmitter
}

// errMediaReaderUnwired — забытая проводка MediaReader в app/server.go: не
// domain-ошибка, чтобы ручка ответила 500 и записала в лог, а не тихим 404.
var errMediaReaderUnwired = errors.New("media reader не подключён")

func New(repo ContactsRepo) *Interactor { return &Interactor{repo: repo} }

// SetPrivacy подключает фильтр видимости телефонов (optional).
func (i *Interactor) SetPrivacy(p PrivacyChecker) { i.privacy = p }

// SetCustomPhotos подключает хранилище личных фото контактов (optional).
func (i *Interactor) SetCustomPhotos(p CustomPhotoRepo) { i.photos = p }

// SetCloseFriends подключает список близких друзей (optional): признак едет
// флагом карточки контакта, как у оригинала.
func (i *Interactor) SetCloseFriends(p CloseFriendsRepo) { i.close = p }

// SetMediaReader подключает проверку «файл свой» для личных фото контактов.
func (i *Interactor) SetMediaReader(m MediaReader) { i.media = m }

// SetEmitter подключает журнал своих устройств (optional): мутации книги
// отдают владельцу карточку контакта строкой user_update.
func (i *Interactor) SetEmitter(e SnapshotEmitter) { i.emit = e }

// publishContactCard — владельцу книги на остальные устройства: карточка userID
// ГЛАЗАМИ ВЛАДЕЛЬЦА после мутации (имя из книги, pFlags.contact, личное фото,
// close_friend). У оригинала это апдейт с users:[user] — клиент кладёт карточку
// в кэш и по смене pFlags.contact двигает книгу (tweb appUsersManager
// saveApiUser :663-782 → onContactUpdated :1216-1228).
//
// Контакту строки нет — сознательно: у него от мутации меняется карточка
// владельца (pFlags.mutual_contact, и фото/номер, если правило владельца даёт
// «контактам»), но пересчёт у собеседников — предмет f6-privacy
// (AnnounceUserTo), и этой задаче он не принадлежит.
//
// Возвращает ту же карточку, что легла в журнал: ею же отвечает ручка, поэтому
// устройство-инициатор (оно получает и кадр, и ответ) не расходится со вторым.
// Зовётся ПОСЛЕ коммита мутации. Сбой журнала ответ не ломает (только лог);
// ошибка — только если карточку не удалось собрать вовсе.
func (i *Interactor) publishContactCard(ctx context.Context, ownerID, userID int64, needCard bool) (domain.UserReal, error) {
	var card domain.UserReal
	built := false
	if i.emit != nil {
		err := i.emit.EmitSnapshot(ctx, ownerID, "user_update", func(ctx context.Context) (map[string]any, error) {
			// Правила читаются ВНУТРИ замка курсора владельца, а не до него: блок и
			// смена last_seen пересчитывают статус отдельной строкой журнала
			// (AnnounceUserTo / reannounce), и она встаёт в порядок замком. Правило,
			// прочитанное до замка, могло бы устареть к моменту записи — снимок с
			// большим pts затёр бы более свежий статус «давно» старым «недавно».
			u, err := i.seenByOwner(ctx, ownerID, userID, i.viewRules(ctx, ownerID, []int64{userID}))
			if err != nil {
				return nil, err
			}
			card, built = u, true
			return map[string]any{"_": domain.UpdateUserSnapshotTag, "user": u}, nil
		})
		if err != nil {
			log.Printf("[user_update] contact card owner=%d user=%d: %v", ownerID, userID, err)
		}
	}
	if built || !needCard {
		return card, nil
	}
	return i.seenByOwner(ctx, ownerID, userID, i.viewRules(ctx, ownerID, []int64{userID}))
}

// viewRules — правила карточки `user` (фото, номер, статус) и присутствие для
// пачки ids глазами ownerID: тот же сборщик, что у всех витрин
// (privacy.ViewRules → domain.UserViewRules.Apply). Сбой правила гасит то, что
// оно охраняет (фото и номер не показываются, статус — «недавно»). Без
// проверяющего приватности фото видно, номер скрыт, а статус карточки не
// трогается: о присутствии ничего не известно, и «давно» клиент принял бы за
// настоящий статус.
func (i *Interactor) viewRules(ctx context.Context, ownerID int64, ids []int64) domain.UserViewRules {
	if i.privacy != nil {
		return i.privacy.ViewRules(ctx, ownerID, ids)
	}
	all := make(map[int64]bool, len(ids))
	for _, id := range ids {
		all[id] = true
	}
	return domain.UserViewRules{ViewerID: ownerID, Photo: all, Phone: map[int64]bool{}, LastSeen: all}
}

// seenByOwner — краткая карточка userID глазами ownerID: имя и pFlags.contact
// из его книги (SeenUser), аватарка по правилу profile_photo пользователя и
// поверх неё личное фото владельца, номер по правилу phone_number, статус по
// last_seen и присутствию (rules — viewRules; всё это делает Apply),
// pFlags.close_friend. Читает только через ctx: зовётся и внутри транзакции с
// замком курсора владельца.
//
// Статус в карточке есть всегда: клиент заменяет карточку в кэше целиком, и
// карточка без `status` стёрла бы у него настоящий статус (tweb насчёт этого
// держит поле живым, appUsersManager.ts:90-102).
func (i *Interactor) seenByOwner(ctx context.Context, ownerID, userID int64, rules domain.UserViewRules) (domain.UserReal, error) {
	u, err := i.repo.SeenUser(ctx, ownerID, userID)
	if err != nil {
		return domain.UserReal{}, err
	}
	users := []domain.UserReal{u}
	// Личное фото задано ЗРИТЕЛЕМ (pFlags.personal): правило аватарки его не гасит.
	if i.photos != nil {
		custom, err := i.photos.CustomPhotoMap(ctx, ownerID, []int64{userID})
		if err != nil {
			return domain.UserReal{}, err
		}
		if mediaID, ok := custom[userID]; ok {
			users[0].Photo = domain.NewUserProfilePhoto(mediaID, nil, false, true)
		}
	}
	rules.Apply(users)
	u = users[0]
	if i.close != nil {
		friends, err := i.close.CloseFriends(ctx, ownerID)
		if err != nil {
			return domain.UserReal{}, err
		}
		u.MarkCloseFriend(slices.Contains(friends, userID))
	}
	return u, nil
}

// SetCustomPhoto задаёт личное фото контакта: mediaID подменяет настоящий
// аватар contactUserID в глазах ownerID (список диалогов/контактов/шапка чата).
// На проводе это userProfilePhoto с pFlags.personal. Требует подключённого
// CustomPhotoRepo.
func (i *Interactor) SetCustomPhoto(ctx context.Context, ownerID, contactUserID, mediaID int64) error {
	if i.photos == nil {
		return domain.ErrNotFound
	}
	if contactUserID == ownerID {
		return ErrSelfContact
	}
	// photos.uploadContactProfilePhoto{file: InputFile} (tweb
	// appProfileManager.ts:1085-1114): личное фото — только своя загрузка.
	if i.media == nil {
		return errMediaReaderUnwired
	}
	m, err := i.media.GetByID(ctx, mediaID)
	if err != nil {
		return err
	}
	if m.OwnerID != ownerID || !strings.HasPrefix(m.Mime, "image/") {
		return domain.ErrNotFound
	}
	if err := i.photos.SetCustomPhoto(ctx, ownerID, contactUserID, mediaID); err != nil {
		return err
	}
	_, _ = i.publishContactCard(ctx, ownerID, contactUserID, false)
	return nil
}

// ClearCustomPhoto сбрасывает личное фото контакта — владелец снова видит его
// настоящий аватар.
func (i *Interactor) ClearCustomPhoto(ctx context.Context, ownerID, contactUserID int64) error {
	if i.photos == nil {
		return domain.ErrNotFound
	}
	if err := i.photos.ClearCustomPhoto(ctx, ownerID, contactUserID); err != nil {
		return err
	}
	_, _ = i.publishContactCard(ctx, ownerID, contactUserID, false)
	return nil
}

// AddInput is the payload for saving (or editing) a contact.
type AddInput struct {
	UserID    int64
	FirstName string
	LastName  string
	// Note — contacts.addContact.note (flags.1?TextWithEntities): nil — поле
	// не прислано, заметка остаётся прежней.
	Note       *domain.TextWithEntities
	SharePhone bool
}

// Add saves a contact in ownerID's address book. Re-adding the same user edits the
// existing entry (upsert). Returns the stored contact enriched with the peer's
// profile fields.
func (i *Interactor) Add(ctx context.Context, ownerID int64, in AddInput) (domain.ContactRecord, error) {
	if in.UserID == ownerID {
		return domain.ContactRecord{}, ErrSelfContact
	}
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.ContactRecord{}, ErrNameRequired
	}
	note, err := sanitizeNote(in.Note)
	if err != nil {
		return domain.ContactRecord{}, err
	}
	c, err := i.repo.Add(ctx, domain.ContactRecord{
		OwnerID:    ownerID,
		UserID:     in.UserID,
		FirstName:  first,
		LastName:   strings.TrimSpace(in.LastName),
		Note:       note,
		SharePhone: in.SharePhone,
	})
	if err != nil {
		return domain.ContactRecord{}, err
	}
	// Бот в контактах недопустим (Telegram). Upsert уже вернул обогащённый is_bot —
	// откатываем запись и отдаём ошибку (defense-in-depth к фронт-фильтру).
	if c.IsBot {
		_, _ = i.repo.Delete(ctx, ownerID, in.UserID)
		return domain.ContactRecord{}, ErrCannotAddBot
	}
	return i.withOwnerCard(ctx, c)
}

// AddByPhoneInput — добавление контакта по номеру телефона (как tweb
// importContact): сервер резолвит номер в пользователя.
type AddByPhoneInput struct {
	Phone      string
	FirstName  string
	LastName   string
	Note       *domain.TextWithEntities
	SharePhone bool
}

// AddByPhone резолвит номер в зарегистрированного пользователя и сохраняет его в
// адресную книгу ownerID. domain.ErrNotFound — номер не зарегистрирован (как
// tweb NO_USER); domain.ErrPrivacy — цель запрещает добавление по номеру
// (правило added_by_phone). first_name обязателен.
func (i *Interactor) AddByPhone(ctx context.Context, ownerID int64, in AddByPhoneInput) (domain.ContactRecord, error) {
	phone := domain.NormalizePhone(in.Phone)
	if phone == "" {
		return domain.ContactRecord{}, ErrPhoneRequired
	}
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.ContactRecord{}, ErrNameRequired
	}
	note, err := sanitizeNote(in.Note)
	if err != nil {
		return domain.ContactRecord{}, err
	}
	userID, err := i.repo.ResolveByPhone(ctx, phone)
	if err != nil {
		return domain.ContactRecord{}, err // domain.ErrNotFound → «номер не зарегистрирован»
	}
	if userID == ownerID {
		return domain.ContactRecord{}, ErrSelfContact
	}
	// Enforcement added_by_phone: цель может ограничить, кто добавляет её по номеру.
	if i.privacy != nil {
		ok, err := i.privacy.Check(ctx, userID, ownerID, domain.PrivacyAddedByPhone)
		if err != nil {
			return domain.ContactRecord{}, err
		}
		if !ok {
			return domain.ContactRecord{}, domain.ErrPrivacy
		}
	}
	c, err := i.repo.Add(ctx, domain.ContactRecord{
		OwnerID:    ownerID,
		UserID:     userID,
		FirstName:  first,
		LastName:   strings.TrimSpace(in.LastName),
		Note:       note,
		SharePhone: in.SharePhone,
	})
	if err != nil {
		return domain.ContactRecord{}, err
	}
	if c.IsBot {
		_, _ = i.repo.Delete(ctx, ownerID, userID)
		return domain.ContactRecord{}, ErrCannotAddBot
	}
	return i.withOwnerCard(ctx, c)
}

// withOwnerCard — запись контакта после мутации: журнал владельцу и ТА ЖЕ
// карточка в ответе ручки. Сырая карточка репозитория (c.User) телефон и фото
// отдаёт без правил приватности и без личного фото и close_friend; устройство-
// инициатор получает и кадр, и ответ — они обязаны совпадать.
//
// Ошибка сборки (не журнала) — 500 после коммита: Add идемпотентен (upsert), и
// повтор клиента доведёт запись; деградировать до сырой карточки репозитория
// нельзя — она отдаёт номер и фото мимо правил приватности. (Delete, у которого
// повтор отвечает 404, деградирует до урезанной карточки.)
func (i *Interactor) withOwnerCard(ctx context.Context, c domain.ContactRecord) (domain.ContactRecord, error) {
	card, err := i.publishContactCard(ctx, c.OwnerID, c.UserID, true)
	if err != nil {
		return domain.ContactRecord{}, err
	}
	c.User = card
	p, ok := card.Photo.(domain.UserProfilePhotoReal)
	c.HasCustomPhoto = ok && p.Personal()
	return c, nil
}

// UpdateNote переписывает заметку контакта (contacts.updateContactNote).
// Пустой текст стирает заметку. domain.ErrNotFound — userID нет в книге
// ownerID: заметка живёт только у контакта.
func (i *Interactor) UpdateNote(ctx context.Context, ownerID, userID int64, note domain.TextWithEntities) error {
	clean, err := sanitizeNote(&note)
	if err != nil {
		return err
	}
	found, err := i.repo.UpdateNote(ctx, ownerID, userID, *clean)
	if err != nil {
		return err
	}
	if !found {
		return domain.ErrNotFound
	}
	return nil
}

// sanitizeNote — заметка ВВОДОМ: предел длины (UTF-16, как offset/length
// разметки) и та же санитизация сущностей, что у сообщения. nil — «поля нет».
func sanitizeNote(n *domain.TextWithEntities) (*domain.TextWithEntities, error) {
	if n == nil {
		return nil, nil
	}
	if len(utf16.Encode([]rune(n.Text))) > domain.ContactNoteMaxLen {
		return nil, domain.ErrTooLong
	}
	entities := domain.SanitizeEntities(n.Entities)
	if n.Text == "" {
		entities = nil
	}
	return domain.NewTextWithEntities(n.Text, entities), nil
}

// List returns ownerID's address book, ordered by saved name. Телефон контакта
// скрывается, когда его правило «кто видит мой номер» не разрешает показ.
func (i *Interactor) List(ctx context.Context, ownerID int64) ([]domain.ContactRecord, error) {
	list, err := i.repo.List(ctx, ownerID)
	if err != nil || len(list) == 0 {
		return list, err
	}
	// Ботов в адресной книге быть не должно (старые записи/сиды) — отфильтровываем.
	filtered := list[:0]
	for _, c := range list {
		if !c.IsBot {
			filtered = append(filtered, c)
		}
	}
	list = filtered
	if len(list) == 0 {
		return list, nil
	}
	ids := make([]int64, 0, len(list))
	for _, c := range list {
		ids = append(ids, c.UserID)
	}
	// Личное фото: подменяем настоящий аватар контакта тем, что владелец задал сам.
	if i.photos != nil {
		custom, err := i.photos.CustomPhotoMap(ctx, ownerID, ids)
		if err != nil {
			return nil, err
		}
		for idx := range list {
			if mediaID, ok := custom[list[idx].UserID]; ok {
				// pFlags.personal — фото задано ЗРИТЕЛЕМ (tweb personal_photo);
				// сам контакт о нём не знает.
				list[idx].User.Photo = domain.NewUserProfilePhoto(mediaID, nil, false, true)
				list[idx].HasCustomPhoto = true
			}
		}
	}
	// Фото, номер и статус — тем же сборщиком и теми же правилами, что в карточке
	// после мутации (seenByOwner), иначе одна и та же карточка выходит разной из
	// GET /contacts и из ответа добавления. Статус обязателен: клиент заменяет
	// карточку целиком и без него стирает живое присутствие контакта.
	cards := make([]domain.UserReal, len(list))
	for idx := range list {
		cards[idx] = list[idx].User
	}
	i.viewRules(ctx, ownerID, ids).Apply(cards)
	for idx := range list {
		list[idx].User = cards[idx]
	}
	// Близкие друзья — ФЛАГ КАРТОЧКИ, а не отдельная витрина-список: у
	// оригинала метода чтения нет вовсе, признак читается с самого `user`
	// (`pFlags.close_friend`). Один запрос на весь список, как у фото и
	// приватности выше.
	if i.close != nil {
		friends, err := i.close.CloseFriends(ctx, ownerID)
		if err != nil {
			return nil, err
		}
		inList := make(map[int64]bool, len(friends))
		for _, id := range friends {
			inList[id] = true
		}
		for idx := range list {
			list[idx].User.MarkCloseFriend(inList[list[idx].UserID])
		}
	}
	return list, nil
}

// Delete removes a contact from ownerID's address book; found is false when there
// was no such entry.
//
// Ответ — карточка удалённого глазами владельца, то есть уже с профильным
// именем и без pFlags.contact: у оригинала contacts.deleteContacts отвечает
// Updates с этим user, и клиент кладёт его в кэш (tweb
// appUsersManager.deleteContacts → processUpdateMessage). Иначе в кэше
// оставалась бы карточка «контакта» с именем из книги. Фото — по тем же
// правилам, что в книге: правило profile_photo, поверх него личное фото.
func (i *Interactor) Delete(ctx context.Context, ownerID, userID int64) (domain.UserReal, bool, error) {
	found, err := i.repo.Delete(ctx, ownerID, userID)
	if err != nil || !found {
		return domain.UserReal{}, found, err
	}
	// Сначала журнал, потом ответ: сбой сборки ответа не должен оставлять
	// остальные устройства без строки об уже закоммиченном удалении.
	u, err := i.publishContactCard(ctx, ownerID, userID, true)
	if err != nil {
		// Карточку со всеми обогатителями собрать не вышло: ответ деградирует до
		// карточки книги без фото и номера, мутация уже совершена.
		log.Printf("[user_update] delete response owner=%d user=%d: %v", ownerID, userID, err)
		u, err = i.repo.SeenUser(ctx, ownerID, userID)
		if err != nil {
			return domain.UserReal{}, true, err
		}
		u.Photo = domain.NewUserProfilePhotoEmpty()
	}
	return u, true, nil
}
