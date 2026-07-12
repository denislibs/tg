defmodule MessengerElixir.Auth.User do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :id, autogenerate: true}
  @timestamps_opts [type: :utc_datetime, inserted_at: :created_at, updated_at: false]
  
  schema "users" do
    field :phone, :string
    field :username, :string
    field :display_name, :string, default: ""
    field :bio, :string, default: ""
    field :avatar_url, :string, default: ""
    
    timestamps(updated_at: false)
    
    has_many :devices, MessengerElixir.Auth.Device
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:phone, :username, :display_name, :bio, :avatar_url])
    |> validate_required([:phone])
    |> unique_constraint(:phone)
    |> unique_constraint(:username)
    |> validate_format(:phone, ~r/^\+\d{10,15}$/)
    |> validate_length(:username, min: 3, max: 32)
    |> validate_format(:username, ~r/^[a-zA-Z][a-zA-Z0-9_]*$/)
  end
end