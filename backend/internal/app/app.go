package app

import (
	"go.uber.org/fx"
	"go.uber.org/fx/fxevent"
)

// Module is the full application dependency graph.
var Module = fx.Options(
	fx.Provide(
		provideConfig,
		provideAppContext,
		providePool,
		provideRedis,
		provideMinio,
		provideAuthRepo,
		provideAuthUsecase,
		provideTxManager,
		provideChatsRepo,
		provideMessagesRepo,
		provideUpdatesRepo,
		provideReactionsRepo,
		provideMediaAccessRepo,
		provideMediaRepo,
		provideGroupRepo,
		provideInviteRepo,
		provideJoinRequestRepo,
		provideChannelRepo,
		provideSearchRepo,
		provideChatUsecase,
		provideStoryRepo,
		provideStoryService,
		provideContactsRepo,
		provideContactsUsecase,
		provideGeoIP,
	),
	fx.Invoke(registerServer),
	// Строго после registerServer: сиду нужен уже дособранный интерактор чата.
	fx.Invoke(registerDemoSeed),
	// Keep our own log.Printf lines as the signal; silence fx's event log.
	fx.WithLogger(func() fxevent.Logger { return fxevent.NopLogger }),
)
