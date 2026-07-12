defmodule MessengerElixirWeb.Router do
  use MessengerElixirWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug CORSPlug, origin: "*"
  end

  pipeline :auth do
    plug MessengerElixirWeb.AuthPipeline
  end

  # Public routes
  scope "/", MessengerElixirWeb do
    pipe_through :api

    get "/health", HealthController, :index
  end

  scope "/auth", MessengerElixirWeb do
    pipe_through :api

    post "/request_code", AuthController, :request_code
    post "/sign_in", AuthController, :sign_in
  end

  # Protected routes
  scope "/api", MessengerElixirWeb do
    pipe_through [:api, :auth]
    
    # Add protected routes here
  end
end
