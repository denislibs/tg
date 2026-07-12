defmodule MessengerElixir.Auth do
  @moduledoc """
  The Auth context for user authentication and session management.
  """

  import Ecto.Query, warn: false
  alias MessengerElixir.Repo
  alias MessengerElixir.Auth.{User, Device}

  @otp_expiry_minutes 5
  @token_length 32

  def request_otp_code(phone) do
    # Normalize phone number
    phone = normalize_phone(phone)
    
    # Check if user exists, create if not
    user = get_or_create_user_by_phone(phone)
    
    # Generate OTP code (in dev mode use DEV_OTP_CODE)
    otp_code = if dev_mode?() do
      Application.get_env(:messenger_elixir, :dev_otp_code, "12345")
    else
      :rand.uniform(99999) |> Integer.to_string() |> String.pad_leading(5, "0")
    end
    
    # Store OTP in Redis with expiry
    store_otp(phone, otp_code)
    
    {:ok, %{message: "OTP code sent", expires_in: @otp_expiry_minutes * 60}}
  end

  def sign_in(phone, otp_code, device_info) do
    phone = normalize_phone(phone)
    
    # Verify OTP
    case verify_otp(phone, otp_code) do
      :ok ->
        # Get or create user
        user = get_or_create_user_by_phone(phone)
        
        # Create device session
        device_hash = generate_device_hash(device_info)
        token = generate_token()
        
        {:ok, device} = create_device(%{
          user_id: user.id,
          device_hash: device_hash,
          device_name: device_info["device_name"] || "Unknown Device",
          platform: device_info["platform"] || "unknown",
          app_version: device_info["app_version"] || "1.0.0",
          ip_address: device_info["ip_address"] || "0.0.0.0",
          location: device_info["location"],
          token: token,
          last_active: DateTime.utc_now(),
          created_at: DateTime.utc_now()
        })
        
        # Clear OTP
        clear_otp(phone)
        
        {:ok, %{
          token: token,
          user: Map.take(user, [:id, :phone, :username, :display_name]),
          device_id: device.id
        }}
        
      :error ->
        {:error, "Invalid or expired OTP code"}
    end
  end

  def get_user(id) do
    Repo.get(User, id)
  end

  def get_user_by_phone(phone) do
    phone = normalize_phone(phone)
    Repo.get_by(User, phone: phone)
  end

  def get_device_by_token(token) do
    Repo.get_by(Device, token: token)
    |> Repo.preload(:user)
  end

  def verify_token(token) do
    case get_device_by_token(token) do
      nil -> {:error, :unauthorized}
      device ->
        # Update last_active
        update_device_activity(device)
        {:ok, device}
    end
  end

  defp get_or_create_user_by_phone(phone) do
    case get_user_by_phone(phone) do
      nil ->
        {:ok, user} = create_user(%{phone: phone})
        user
      user ->
        user
    end
  end

  defp create_user(attrs) do
    %User{}
    |> User.changeset(Map.put(attrs, :created_at, DateTime.utc_now()))
    |> Repo.insert()
  end

  defp create_device(attrs) do
    %Device{}
    |> Device.changeset(attrs)
    |> Repo.insert()
  end

  defp update_device_activity(device) do
    device
    |> Ecto.Changeset.change(last_active: DateTime.utc_now())
    |> Repo.update()
  end

  defp normalize_phone(phone) do
    phone
    |> String.replace(~r/[^\d+]/, "")
    |> ensure_plus_prefix()
  end

  defp ensure_plus_prefix(phone) do
    if String.starts_with?(phone, "+") do
      phone
    else
      "+" <> phone
    end
  end

  defp generate_device_hash(device_info) do
    data = "#{device_info["platform"]}:#{device_info["device_name"]}:#{device_info["app_version"]}"
    :crypto.hash(:sha256, data) |> Base.encode16(case: :lower)
  end

  defp generate_token do
    :crypto.strong_rand_bytes(@token_length) |> Base.url_encode64(padding: false)
  end

  defp dev_mode? do
    Application.get_env(:messenger_elixir, :dev_otp_code) != nil
  end

  # Redis OTP operations
  defp store_otp(phone, code) do
    redis_url = Application.get_env(:messenger_elixir, :redis_url)
    {:ok, conn} = Redix.start_link(redis_url)
    key = "otp:#{phone}"
    Redix.command!(conn, ["SET", key, code, "EX", @otp_expiry_minutes * 60])
    Redix.stop(conn)
  end

  defp verify_otp(phone, code) do
    redis_url = Application.get_env(:messenger_elixir, :redis_url)
    {:ok, conn} = Redix.start_link(redis_url)
    key = "otp:#{phone}"
    
    stored_code = Redix.command!(conn, ["GET", key])
    Redix.stop(conn)
    
    if stored_code == code do
      :ok
    else
      :error
    end
  end

  defp clear_otp(phone) do
    redis_url = Application.get_env(:messenger_elixir, :redis_url)
    {:ok, conn} = Redix.start_link(redis_url)
    key = "otp:#{phone}"
    Redix.command!(conn, ["DEL", key])
    Redix.stop(conn)
  end
end