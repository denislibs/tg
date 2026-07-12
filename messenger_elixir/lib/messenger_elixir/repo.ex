defmodule MessengerElixir.Repo do
  use Ecto.Repo,
    otp_app: :messenger_elixir,
    adapter: Ecto.Adapters.Postgres
end
