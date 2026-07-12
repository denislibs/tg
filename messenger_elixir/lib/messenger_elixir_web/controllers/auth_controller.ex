defmodule MessengerElixirWeb.AuthController do
  use MessengerElixirWeb, :controller
  
  alias MessengerElixir.Auth

  def request_code(conn, %{"phone" => phone}) do
    case Auth.request_otp_code(phone) do
      {:ok, response} ->
        json(conn, response)
      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: reason})
    end
  end

  def sign_in(conn, %{"phone" => phone, "code" => code} = params) do
    device_info = %{
      "device_name" => params["device_name"] || "Web Client",
      "platform" => params["platform"] || "web",
      "app_version" => params["app_version"] || "1.0.0",
      "ip_address" => get_client_ip(conn),
      "location" => params["location"]
    }
    
    case Auth.sign_in(phone, code, device_info) do
      {:ok, response} ->
        json(conn, response)
      {:error, reason} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: reason})
    end
  end

  defp get_client_ip(conn) do
    forwarded_for = Plug.Conn.get_req_header(conn, "x-forwarded-for")
    
    case forwarded_for do
      [ip | _] -> ip |> String.split(",") |> List.first() |> String.trim()
      [] -> 
        conn.remote_ip
        |> :inet.ntoa()
        |> List.to_string()
    end
  end
end