defmodule MessengerElixir.Auth.Device do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :id, autogenerate: true}
  schema "devices" do
    belongs_to :user, MessengerElixir.Auth.User
    field :device_hash, :string
    field :device_name, :string
    field :platform, :string
    field :app_version, :string
    field :ip_address, :string
    field :location, :string
    field :last_active, :utc_datetime
    field :token, :string
    field :created_at, :utc_datetime
  end

  def changeset(device, attrs) do
    device
    |> cast(attrs, [:user_id, :device_hash, :device_name, :platform, :app_version, :ip_address, :location, :token])
    |> validate_required([:user_id, :device_hash, :token])
    |> unique_constraint(:token)
  end
end