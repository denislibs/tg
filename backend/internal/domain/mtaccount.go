package domain

// Аккаунт: сессии устройств, контакты, уведомления, фотогалерея.
//
// Четыре витрины, у каждой конструктор в схеме уже был, а ехала она безымянной
// картой со своим набором ключей.

const (
	AuthorizationTag         = "authorization"
	AccountAuthorizationsTag = "account.authorizations"
	ContactTag               = "contact"
	ContactsContactsTag      = "contacts.contacts"
	PhotosPhotoTag           = "photos.photo"
	PhotosPhotosTag          = "photos.photos"
)

// authorization#ad01d61d flags:# current:flags.0?true … hash:long
// device_model:string platform:string system_version:string api_id:int
// app_name:string app_version:string date_created:int date_active:int
// ip:string country:string region:string = Authorization;
//
// Сессия устройства. «Текущая» — ФЛАГ, а не булево поле рядом: прежде ехало
// `current: false`, то есть «выключено» имело значение.
//
// Адрес сессии — `hash`, и у ТЕКУЩЕЙ он равен нулю. Это семантика схемы, а не
// наша выдумка: `hash` — то, чем сессию ОТЗЫВАЮТ, а текущую авторизацию по
// hash отозвать нельзя, для неё есть выход из аккаунта. Клиент на этом и
// стоит: вкладка «Устройства» (tweb `activeSessions.tsx:132,157`) отличает
// свою строку по `dataset.hash === '0'` и только её не даёт завершить кликом.
//
// Реквизиты клиента разложены как в `initConnection` MTProto, откуда их и
// берёт оригинал (tweb `networkerFactory.ts:45-47`): `device_model` — чем
// пользуются (браузер), `system_version` — на чём (ОС), `app_version` — версия
// сборки клиента, сообщённая при входе. Разбирает User-Agent СЕРВЕР (так же
// делает Telegram: клиент шлёт сырую строку UA, а на экране видно «Chrome»),
// поэтому браузер и ОС лежат в разных колонках, а не склеены в одну строку.
//
// `app_name` даёт СЕРВЕР, а не клиент: у оригинала имя приложения приезжает из
// реестра api_id (клиент его в initConnection не шлёт вовсе), и клиент,
// называющий себя сам, назвался бы как угодно. Клиент у нас один — отсюда
// константа.
//
// Что мы не производим и почему — в OmittedWithoutSubject: `api_id` есть
// только у клиентов MTProto, а `region` мы не различаем — город и страна
// приезжают одной строкой.
type Authorization struct {
	Underscore    string          `json:"_"`
	PFlags        map[string]bool `json:"pFlags"`
	Hash          int64           `json:"hash"`
	DeviceModel   string          `json:"device_model"`
	Platform      string          `json:"platform"`
	SystemVersion string          `json:"system_version"`
	AppName       string          `json:"app_name"`
	AppVersion    string          `json:"app_version"`
	DateCreated   int             `json:"date_created"`
	DateActive    int             `json:"date_active"`
	IP            string          `json:"ip"`
	Country       string          `json:"country"`
}

// AppName — имя нашего клиента глазами сервера (см. докблок Authorization:
// у оригинала оно приходит из реестра api_id, а не от самого клиента).
const AppName = "Telegram Web"

// NewAuthorization — сессия устройства глазами владельца.
func NewAuthorization(d Device, current bool) Authorization {
	// Ноль — адрес «этой самой» сессии, см. докблок выше.
	hash := d.ID
	if current {
		hash = 0
	}
	out := Authorization{
		Underscore:    AuthorizationTag,
		Hash:          hash,
		DeviceModel:   d.Name,
		Platform:      d.Platform,
		SystemVersion: d.SystemVersion,
		AppName:       AppName,
		AppVersion:    d.AppVersion,
		DateCreated:   unixSeconds(d.CreatedAt),
		DateActive:    unixSeconds(d.LastActive),
		IP:            d.IP,
		Country:       d.Location,
	}
	// pFlags у сессии едет ВСЕГДА объектом, даже пустым, — и потому НЕ через
	// setPFlag (тот зануляет пустую карту под `omitempty`). Так делает
	// десериализатор оригинала: `result.pFlags ??= {}` у любого конструктора с
	// `flags:#` (tweb `tl_utils.ts:754`), поэтому в его типе поле обязательное
	// (`layer.d.ts`, `Authorization.authorization.pFlags`), и клиент читает
	// `auth.pFlags.current` без страховки. Пропуск ключа ронял дословный порт
	// вкладки на TypeError, как только текущая сессия оказывалась не первой.
	//
	// Точечно, а не по всей модели: у остальных шести десятков конструкторов
	// «пустых pFlags в JSON нет» — проверяемый инвариант их собственных сверок
	// (тост бота, готовая расшифровка, непринуждённый диалог), и снятие
	// `omitempty` разом сломало бы их. Провод TL этой разницы не знает вовсе:
	// там pFlags восстанавливает читающая сторона по маске.
	out.PFlags = map[string]bool{}
	if current {
		out.PFlags["current"] = true
	}
	return out
}

// account.authorizations#4bff8ea0 authorization_ttl_days:int
// authorizations:Vector<Authorization> = account.Authorizations;
//
// `authorization_ttl_days` — через сколько дней простоя сессия гаснет сама.
// Автогашения у нас нет вовсе, поэтому 0.
type AccountAuthorizations struct {
	Underscore           string          `json:"_"`
	AuthorizationTTLDays int             `json:"authorization_ttl_days"`
	Authorizations       []Authorization `json:"authorizations"`
}

func NewAccountAuthorizations(list []Authorization) AccountAuthorizations {
	return AccountAuthorizations{
		Underscore:     AccountAuthorizationsTag,
		Authorizations: orEmpty(list),
	}
}

// contact#145ade0b user_id:long mutual:Bool = Contact;
//
// СТРОКА адресной книги: ссылка на пользователя плюс взаимность. Карточка
// самого пользователя едет вектором `users` контейнера — прежде она была
// вклеена в строку рядом со ссылкой.
//
// `mutual` тут — `Bool`, то есть КОНСТРУКТОР, а не голое булево: у оригинала
// это полноценный тип, и в объекте он объектом и лежит.
type Contact struct {
	Underscore string `json:"_"`
	UserID     int64  `json:"user_id"`
	Mutual     Bool   `json:"mutual"`
}

func NewContact(userID int64, mutual bool) Contact {
	return Contact{Underscore: ContactTag, UserID: userID, Mutual: NewBool(mutual)}
}

// contacts.contacts#eae87e42 contacts:Vector<Contact> saved_count:int
// users:Vector<User> = contacts.Contacts;
//
// `saved_count` — сколько контактов сохранено на сервере (у оригинала это
// число импортированных из телефонной книги). У нас книга и есть сервер,
// поэтому оно равно длине вектора.
type ContactsContacts struct {
	Underscore string     `json:"_"`
	Contacts   []Contact  `json:"contacts"`
	SavedCount int        `json:"saved_count"`
	Users      []UserReal `json:"users"`
}

func NewContactsContacts(contacts []Contact, users []UserReal) ContactsContacts {
	return ContactsContacts{
		Underscore: ContactsContactsTag,
		Contacts:   orEmpty(contacts),
		SavedCount: len(contacts),
		Users:      orEmpty(users),
	}
}

// photos.photo#20212ca8 photo:Photo users:Vector<User> = photos.Photo;
//
// Одна фотография галереи. Прежде витрина отдавала строку таблицы
// (`{id, media_id, video_media_id, created_at}`) — то есть НАШ ключ строки
// рядом с номером файла; у конструктора адрес один, и это адрес самого файла.
type PhotosPhoto struct {
	Underscore string     `json:"_"`
	Photo      Photo      `json:"photo"`
	Users      []UserReal `json:"users"`
}

func NewPhotosPhoto(p Photo) PhotosPhoto {
	return PhotosPhoto{Underscore: PhotosPhotoTag, Photo: p, Users: []UserReal{}}
}

// photos.photos#8dca6aa5 photos:Vector<Photo> users:Vector<User>
// = photos.Photos;
type PhotosPhotos struct {
	Underscore string     `json:"_"`
	Photos     []Photo    `json:"photos"`
	Users      []UserReal `json:"users"`
}

func NewPhotosPhotos(photos []Photo) PhotosPhotos {
	return PhotosPhotos{
		Underscore: PhotosPhotosTag,
		Photos:     orEmpty(photos),
		Users:      []UserReal{},
	}
}
