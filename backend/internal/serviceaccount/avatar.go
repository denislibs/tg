// Package serviceaccount — вшитые в бинарь данные служебного аккаунта
// Telegram (777000, domain.ServiceUserID), которые миграция положить не может:
// у SQL нет доступа к объектному хранилищу.
package serviceaccount

import _ "embed"

// Avatar — фото профиля служебного аккаунта (JPEG 512×512).
//
// У оригинала отдельного глифа для 777000 нет: это ОБЫЧНАЯ фотография пира
// (`img.avatar-photo`, tweb avatarNew.tsx — ни одной ветки по SERVICE_PEER_ID),
// её отдаёт сервер. Картинка собрана из логотипа самого tweb
// (`public/assets/img/logo_filled_rounded.png`, круг на всю площадь), положенного
// на его же синий (#3390EC, `logo.svg`), — квадрат, который клиент обрезает
// кругом. Ставит её при старте auth.Interactor.EnsureServiceAvatar.
//
//go:embed avatar.jpg
var Avatar []byte

// AvatarSize — сторона квадрата в пикселях (нужна записи media).
const AvatarSize = 512
