defmodule MessengerElixirWeb.AuthPipeline do
  use Guardian.Plug.Pipeline,
    otp_app: :messenger_elixir,
    module: MessengerElixir.Auth.Guardian,
    error_handler: MessengerElixirWeb.AuthErrorHandler

  plug Guardian.Plug.VerifyHeader, scheme: "Bearer"
  plug Guardian.Plug.LoadResource, allow_blank: false
end