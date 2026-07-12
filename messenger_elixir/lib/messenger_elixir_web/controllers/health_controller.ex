defmodule MessengerElixirWeb.HealthController do
  use MessengerElixirWeb, :controller

  def index(conn, _params) do
    json(conn, %{status: "ok", service: "messenger_elixir"})
  end
end