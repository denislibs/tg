package app

import (
	"context"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/adapter/media/ffmpeg"
	webpushadapter "github.com/messenger-denis/backend/internal/adapter/push/webpush"
	queueredis "github.com/messenger-denis/backend/internal/adapter/queue/redis"
	rtredis "github.com/messenger-denis/backend/internal/adapter/realtime/redis"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/config"
	httptransport "github.com/messenger-denis/backend/internal/adapter/delivery/http"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasepresence "github.com/messenger-denis/backend/internal/usecase/presence"
	usecasepush "github.com/messenger-denis/backend/internal/usecase/push"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
	"go.uber.org/fx"
)

// serverParams are the dependencies the assembler pulls from the fx graph.
type serverParams struct {
	fx.In

	LC      fx.Lifecycle
	Cfg     *config.Config
	Ctx     context.Context
	Pool    *pgxpool.Pool
	Redis   RedisResult
	Minio   MinioResult
	AuthUC  *usecaseauth.Interactor
	ChatUC  *usecasechat.Interactor
	StoryUC *storyusecase.Service
}

// registerServer wires the (optional) realtime/push/media features onto the
// services, builds the router + HTTP server, and registers lifecycle hooks.
// This mirrors the previous main.go assembly; later slices decompose it.
func registerServer(p serverParams) {
	var wsHandler http.Handler
	var presenceMgr *usecasepresence.Manager
	if p.Redis.OK {
		p.AuthUC.SetCache(redisSessionCache(p.Redis))
		p.AuthUC.SetQRStore(redisQRStore(p.Redis))
		publisher := rtredis.NewRedisPublisher(p.Redis.Client)
		p.ChatUC.SetPublisher(publisher)
		p.ChatUC.SetChannelPublisher(publisher)
		p.AuthUC.SetRevocationNotifier(publisher)
		presenceMgr = usecasepresence.NewManager(rtredis.NewPresenceStore(p.Redis.Client), publisher, p.ChatUC.ChatPartners, 35*time.Second)
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
	if p.Minio.OK {
		mediaUC := usecasemedia.New(pgadapter.NewMediaRepo(p.Pool), p.Minio.Client, ffmpeg.New())
		mediaHandler = httptransport.NewMediaHandler(mediaUC, p.ChatUC, p.AuthUC, p.Cfg.MediaURLSecret)
		log.Printf("media enabled (minio bucket %q)", p.Cfg.MinioBucket)
	}

	// Pass presence as a PresenceQuery only when it's actually wired; passing a
	// typed-nil *Manager would yield a non-nil interface and defeat the handler's
	// nil-check. When disabled, the members endpoint reports online=false.
	var memberPresence httptransport.PresenceQuery
	if presenceMgr != nil {
		memberPresence = presenceMgr
	}

	storyHandler := httptransport.NewStoryHandler(p.StoryUC)

	srv := &http.Server{
		Addr:              p.Cfg.HTTPAddr,
		Handler:           httptransport.NewRouter(p.AuthUC, p.ChatUC, wsHandler, mediaHandler, pushHandler, storyHandler, memberPresence),
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
