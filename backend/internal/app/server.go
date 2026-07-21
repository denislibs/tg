package app

import (
	"context"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/adapter/botmedia"
	httptransport "github.com/messenger-denis/backend/internal/adapter/delivery/http"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws"
	"github.com/messenger-denis/backend/internal/adapter/geoip"
	"github.com/messenger-denis/backend/internal/adapter/media/ffmpeg"
	webpushadapter "github.com/messenger-denis/backend/internal/adapter/push/webpush"
	queueredis "github.com/messenger-denis/backend/internal/adapter/queue/redis"
	rtredis "github.com/messenger-denis/backend/internal/adapter/realtime/redis"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/adapter/translate/libretranslate"
	"github.com/messenger-denis/backend/internal/config"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
	usecasepasskeys "github.com/messenger-denis/backend/internal/usecase/passkeys"
	usecasepresence "github.com/messenger-denis/backend/internal/usecase/presence"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
	usecasereport "github.com/messenger-denis/backend/internal/usecase/report"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
	"go.uber.org/fx"
)

// serverParams are the dependencies the assembler pulls from the fx graph.
type serverParams struct {
	fx.In

	LC         fx.Lifecycle
	Cfg        *config.Config
	Ctx        context.Context
	Pool       *pgxpool.Pool
	Redis      RedisResult
	Minio      MinioResult
	AuthUC     *usecaseauth.Interactor
	ChatUC     *usecasechat.Interactor
	StoryUC    *storyusecase.Service
	ContactsUC *usecasecontacts.Interactor
	GeoIP      *geoip.Resolver
}

// registerServer wires the (optional) realtime/push/media features onto the
// services, builds the router + HTTP server, and registers lifecycle hooks.
// This mirrors the previous main.go assembly; later slices decompose it.
func registerServer(p serverParams) {
	// The chat usecase delivers system notifications (login alerts) into the
	// official service account's chat; auth fires them after a new device signs in.
	p.AuthUC.SetServiceNotifier(p.ChatUC)
	if p.GeoIP != nil {
		p.AuthUC.SetGeoResolver(p.GeoIP)
	}

	// Конфиденциальность: правила «кто видит/может» + чёрный список. Гейтит
	// отправку/звонки/приглашения в чате, телефоны контактов и last seen.
	privacyUC := usecaseprivacy.New(pgadapter.NewPrivacyRepo(p.Pool))
	p.ChatUC.SetPrivacy(privacyUC)
	p.ContactsUC.SetPrivacy(privacyUC)

	// Облачные черновики: хранение per (чат, пользователь) + синк draft_update.
	p.ChatUC.SetDrafts(pgadapter.NewDraftsRepo(p.Pool))

	// Опросы: хранение + голоса, live-агрегаты фреймом poll_update.
	p.ChatUC.SetPolls(pgadapter.NewPollsRepo(p.Pool))

	// Запланированные сообщения: очередь + фоновая отправка (тикер ниже).
	p.ChatUC.SetScheduled(pgadapter.NewScheduledRepo(p.Pool))

	// Форум-топики: темы групп поверх тредов (thread_root_id).
	p.ChatUC.SetTopics(pgadapter.NewTopicsRepo(p.Pool))

	// Секретные чаты (E2E): handshake хранит только публичные ключи + статус.
	p.ChatUC.SetSecret(pgadapter.NewSecretRepo(p.Pool))

	// Звёзды и подарки: баланс + каталог + выданные подарки, live-баланс
	// фреймом balance_update, подарок — сообщением типа 'gift'.
	p.ChatUC.SetStars(pgadapter.NewStarsRepo(p.Pool))

	// Боты: флаг is_bot + команды; демо-бот авто-отвечает в приватном чате.
	p.ChatUC.SetBots(pgadapter.NewBotRepo(p.Pool))

	// Bot API: боты-сервисы с токенами (getUpdates/webhook, sendMessage, …) и
	// @BotFather (создание/управление ботами, mini-app).
	p.ChatUC.SetBotAPI(pgadapter.NewBotAPIRepo(p.Pool))

	// Перевод сообщений: LibreTranslate-совместимый сервис (опционально).
	if p.Cfg.TranslateURL != "" {
		p.ChatUC.SetTranslator(libretranslate.New(p.Cfg.TranslateURL, p.Cfg.TranslateAPIKey))
		log.Printf("message translation enabled (%s)", p.Cfg.TranslateURL)
	} else {
		log.Printf("message translation disabled (set TRANSLATE_URL to enable)")
	}

	var wsHandler http.Handler
	var presenceMgr *usecasepresence.Manager
	if p.Redis.OK {
		p.AuthUC.SetCache(redisSessionCache(p.Redis))
		p.AuthUC.SetQRStore(redisQRStore(p.Redis))
		publisher := rtredis.NewRedisPublisher(p.Redis.Client)
		p.ChatUC.SetPublisher(publisher)
		p.ChatUC.SetChannelPublisher(publisher)
		p.ChatUC.SetGroupCalls(redisGroupCalls(p.Redis))
		p.AuthUC.SetRevocationNotifier(publisher)
		presenceMgr = usecasepresence.NewManager(rtredis.NewPresenceStore(p.Redis.Client), publisher, p.ChatUC.ChatPartners, 35*time.Second)
		presenceMgr.SetPrivacy(privacyUC)
		hub := ws.NewHub(p.Ctx, p.Redis.Client)
		p.LC.Append(fx.Hook{OnStop: func(context.Context) error { return hub.Close() }})
		wsHandler = ws.NewHandler(hub, p.AuthUC, p.ChatUC, presenceMgr)
		log.Printf("session cache + realtime + presence enabled (redis)")
	}

	var pushHandler *httptransport.PushHandler
	if p.Redis.OK && p.Cfg.VAPIDPublicKey != "" && p.Cfg.VAPIDPrivateKey != "" {
		pushRepo := pgadapter.NewPushRepo(p.Pool)
		queue := queueredis.NewQueue(p.Redis.Client)
		notifier := usecasepush.NewNotifier(rtredis.NewPresenceStore(p.Redis.Client), pushRepo, queue)
		p.ChatUC.SetNotifier(notifier)
		sender := webpushadapter.NewSender(p.Cfg.VAPIDPublicKey, p.Cfg.VAPIDPrivateKey, p.Cfg.VAPIDSubject)
		worker := usecasepush.NewWorker(queue, pushRepo, sender, pushRepo)
		p.LC.Append(fx.Hook{OnStart: func(context.Context) error { go worker.Run(p.Ctx); return nil }})
		pushHandler = httptransport.NewPushHandler(pushRepo, p.Cfg.VAPIDPublicKey)
		log.Printf("web push enabled")
	} else {
		log.Printf("web push disabled (needs redis + VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)")
	}

	var mediaHandler *httptransport.MediaHandler
	var mediaUC *usecasemedia.Interactor
	if p.Minio.OK {
		mediaUC = usecasemedia.New(pgadapter.NewMediaRepo(p.Pool), p.Minio.Client, ffmpeg.New())
		mediaHandler = httptransport.NewMediaHandler(mediaUC, p.ChatUC, p.AuthUC, p.Cfg.MediaURLSecret)
		// Bot API sendPhoto/Document/Video: боты кладут медиа через media usecase.
		p.ChatUC.SetBotMedia(botmedia.New(mediaUC))
		log.Printf("media enabled (minio bucket %q)", p.Cfg.MinioBucket)
	}

	// Pass presence as a PresenceQuery only when it's actually wired; passing a
	// typed-nil *Manager would yield a non-nil interface and defeat the handler's
	// nil-check. When disabled, the members endpoint reports online=false.
	var memberPresence httptransport.PresenceQuery
	if presenceMgr != nil {
		memberPresence = presenceMgr
	}

	// Фоновая чистка сообщений с истёкшим автоудалением (delete_message для всех).
	p.LC.Append(fx.Hook{OnStart: func(context.Context) error {
		go func() {
			t := time.NewTicker(15 * time.Second)
			defer t.Stop()
			for {
				select {
				case <-p.Ctx.Done():
					return
				case <-t.C:
					if n, err := p.ChatUC.PurgeExpiredMessages(p.Ctx); err != nil {
						log.Printf("auto-delete purge: %v", err)
					} else if n > 0 {
						log.Printf("auto-delete: purged %d message(s)", n)
					}
					if n, err := p.ChatUC.DispatchDueScheduled(p.Ctx); err != nil {
						log.Printf("scheduled dispatch: %v", err)
					} else if n > 0 {
						log.Printf("scheduled: sent %d message(s)", n)
					}
				}
			}
		}()
		return nil
	}})

	storyHandler := httptransport.NewStoryHandler(p.StoryUC)
	notifyUC := usecasenotify.New(pgadapter.NewNotifyRepo(p.Pool))
	// Жалобы на чаты/сообщения (tweb reportMessages): складируем без модерации.
	reportUC := usecasereport.New(pgadapter.NewReportRepo(p.Pool))
	foldersUC := usecasefolders.New(pgadapter.NewFoldersRepo(p.Pool), pgadapter.NewFolderChatAccess(p.Pool), pgadapter.NewTxManager(p.Pool))
	// Публичная страница-превью @username (аналог t.me)
	pubH := httptransport.NewPublicHandler(usecasepublic.New(pgadapter.NewPublicRepo(p.Pool)), mediaUC)

	// Ключи доступа (WebAuthn): опциональны — при кривом RP-конфиге фича
	// отключается, приложение работает дальше.
	passkeysUC := usecasepasskeys.New(pgadapter.NewPasskeysRepo(p.Pool))
	passkeyH, err := httptransport.NewPasskeyHandler(p.Cfg.WebAuthnRPID, p.Cfg.WebAuthnOrigins, passkeysUC, p.AuthUC)
	if err != nil {
		log.Printf("passkeys disabled (webauthn config): %v", err)
		passkeyH = nil
	} else {
		log.Printf("passkeys enabled (rp id %q)", p.Cfg.WebAuthnRPID)
	}

	srv := &http.Server{
		Addr:              p.Cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(p.AuthUC, p.ChatUC, wsHandler, mediaHandler, mediaUC, pushHandler, storyHandler, memberPresence, p.ContactsUC, httptransport.NewICEHandler(p.Cfg.TurnHost, p.Cfg.TurnSecret), notifyUC, foldersUC, pubH, privacyUC, passkeyH, reportUC),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	p.LC.Append(fx.Hook{
		OnStart: func(context.Context) error {
			ln, err := net.Listen("tcp", srv.Addr)
			if err != nil {
				return err
			}
			go func() {
				if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
					log.Fatalf("serve: %v", err)
				}
			}()
			log.Printf("listening on %s", p.Cfg.HTTPAddr)
			return nil
		},
		OnStop: func(ctx context.Context) error { return srv.Shutdown(ctx) },
	})
}

// redisSessionCache is a tiny helper so server.go doesn't import redisstore twice.
func redisSessionCache(r RedisResult) usecaseauth.SessionCache {
	return newSessionCache(r.Client)
}

// redisQRStore is a tiny helper so server.go doesn't import redisstore twice.
func redisQRStore(r RedisResult) usecaseauth.QRStore {
	return newQRStore(r.Client)
}

// redisGroupCalls — стор участников групповых звонков.
func redisGroupCalls(r RedisResult) usecasechat.GroupCallStore {
	return newGroupCallStore(r.Client)
}
