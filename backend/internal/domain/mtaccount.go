package domain

import "time"

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
// Адрес сессии у оригинала — `hash`, у нас числовой id устройства; имя
// параметра берём схемное.
//
// Что мы не производим и почему — в OmittedWithoutSubject: реквизиты
// приложения (`api_id`, `app_name`, `app_version`, `system_version`) есть
// только у клиентов MTProto, а `region` мы не различаем — город и страна
// приезжают одной строкой.
type Authorization struct {
	Underscore  string          `json:"_"`
	PFlags      map[string]bool `json:"pFlags,omitempty"`
	Hash        int64           `json:"hash"`
	DeviceModel string          `json:"device_model"`
	Platform    string          `json:"platform"`
	DateCreated int             `json:"date_created"`
	DateActive  int             `json:"date_active"`
	IP          string          `json:"ip"`
	Country     string          `json:"country"`
}

// NewAuthorization — сессия устройства глазами владельца.
func NewAuthorization(id int64, name, platform, ip, country string, created, active time.Time, current bool) Authorization {
	out := Authorization{
		Underscore:  AuthorizationTag,
		Hash:        id,
		DeviceModel: name,
		Platform:    platform,
		DateCreated: unixSeconds(created),
		DateActive:  unixSeconds(active),
		IP:          ip,
		Country:     country,
	}
	setPFlag(&out.PFlags, "current", current)
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
