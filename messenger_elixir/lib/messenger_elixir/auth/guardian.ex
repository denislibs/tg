defmodule MessengerElixir.Auth.Guardian do
  use Guardian, otp_app: :messenger_elixir

  alias MessengerElixir.Auth

  def subject_for_token(resource, _claims) do
    sub = to_string(resource.id)
    {:ok, sub}
  end

  def resource_from_claims(claims) do
    id = claims["sub"]
    
    case Auth.get_device_by_token(claims["token"]) do
      nil -> {:error, :not_found}
      device -> {:ok, device}
    end
  end
end