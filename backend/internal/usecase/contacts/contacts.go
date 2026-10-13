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

// emitContactCard — владельцу книги на остальные устройства: карточка userID
// ГЛАЗАМИ ВЛАДЕЛЬЦА после мутации (имя из книги, pFlags.contact, личное фото,
// close_friend). У оригинала это апдейт с users:[user] — клиент кладёт карточку
// в кэш и по смене pFlags.contact двигает книгу (tweb appUsersManager
// saveApiUser :663-782 → onContactUpdated :1216-1228). Контакту строки нет: его
// карточка от этой мутации не меняется.
//
// Зовётся ПОСЛЕ коммита мутации. Сбой журнала ответ не ломает: устройство
// догонит книгу следующим чтением.
func (i *Interactor) emitContactCard(ctx context.Context, ownerID, userID int64) {
	if i.emit == nil {
		return
	}
	err := i.emit.EmitSnapshot(ctx, ownerID, "user_update", func(ctx context.Context) (map[string]any, error) {
		u, err := i.seenByOwner(ctx, ownerID, userID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"_": domain.UpdateUserSnapshotTag, "user": u}, nil
	})
	if err != nil {
		log.Printf("[user_update] contact card owner=%d user=%d: %v", ownerID, userID, err)
	}
}

// seenByOwner — краткая карточка userID глазами ownerID: имя и pFlags.contact
// из его книги (SeenUser), аватарка по правилу profile_photo пользователя и
// поверх неё личное фото владельца, номер по правилу phone_number,
// pFlags.close_friend. Без проверяющего приватности фото видно, номер скрыт —
// та же мягкая деградация, что у domain.UncheckedUserViewRules.
func (i *Interactor) seenByOwner(ctx context.Context, ownerID, userID int64) (domain.UserReal, error) {
	u, err := i.repo.SeenUser(ctx, ownerID, userID)
	if err != nil {
		return domain.UserReal{}, err
	}
	users := []domain.UserReal{u}
	rules := domain.UncheckedUserViewRules(ownerID, users)
	// Присутствие в снимок не входит: своё место у него — updateUserStatus, а
	// «ничего не известно» в карточке стёрло бы у клиента настоящий статус.
	rules.Status = nil
	if i.privacy != nil {
		photo, err := i.privacy.VisibleMap(ctx, ownerID, []int64{userID}, domain.PrivacyProfilePhoto)
		if err != nil {
			return domain.UserReal{}, err
		}
		phone, err := i.privacy.VisibleMap(ctx, ownerID, []int64{userID}, domain.PrivacyPhoneNumber)
		if err != nil {
			return domain.UserReal{}, err
		}
		rules.Photo, rules.Phone = photo, phone
	}
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
	i.emitContactCard(ctx, ownerID, contactUserID)
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
	i.emitContactCard(ctx, ownerID, contactUserID)
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
	i.emitContactCard(ctx, ownerID, in.UserID)
	return c, nil
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
	i.emitContactCard(ctx, ownerID, userID)
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
	if i.privacy != nil {
		vis, err := i.privacy.VisibleMap(ctx, ownerID, ids, domain.PrivacyPhoneNumber)
		if err != nil {
			return nil, err
		}
		for idx := range list {
			if !vis[list[idx].UserID] {
				list[idx].User.Phone = ""
			}
		}
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
	u, err := i.seenByOwner(ctx, ownerID, userID)
	if err != nil {
		return domain.UserReal{}, true, err
	}
	i.emitContactCard(ctx, ownerID, userID)
	return u, true, nil
}
