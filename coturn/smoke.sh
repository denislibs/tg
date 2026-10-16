#!/bin/sh
# Проверка защиты relay на coturn стенда или dev — после любой правки turnserver.conf или флагов
# compose. Не на нагруженном проде: аллокации прогона (~20) держат total-quota 600 с.
#   coturn/smoke.sh <контейнер coturn>
# Клиент — turnutils_uclient из того же образа, секрет берётся из командной строки процесса
# coturn внутри контейнера (не светится в argv хоста). IPv4 — через адрес контейнера (relay на
# нём), IPv6 — через ::1 (coturn поднимает на нём IPv6-релей).
# Ждём: публичные пиры (TEST-NET-3, 2001:db8::/32 — пакеты никуда не уходят) — аллокация и
# разрешение без ошибок; запрещённые — 403; relay↔relay на своём адресе — без потерь; TCP-relay — 442.
# С TURN_RELAY_IP/--external-ip проверка relay↔relay идёт через этот адрес, а не адрес контейнера.
set -u
C=${1:?контейнер coturn}
fail=0 n=0
# Имя на каждый запуск своё: квота считается по имени, аллокации живут 600 с после выхода.
run() { # адрес сервера (v4 — адрес контейнера, v6 — ::1), аргументы uclient…
  n=$((n + 1)) srv=$1; shift
  docker exec "$C" sh -c '
    srv=$0 u=$1; shift
    [ "$srv" = v4 ] && srv=$(hostname -i | cut -d" " -f1) || srv=::1
    s=$(tr "\0" "\n" </proc/1/cmdline | sed -n "s/^--static-auth-secret=//p")
    turnutils_uclient -W "$s" -u "$u" -n 2 "$@" "$srv" 2>&1' "$srv" "smoke-$$-$n" "$@"
}
expect() { # имя, ok|403|442|clean, сервер, аргументы uclient…
  name=$1 want=$2; shift 2
  out=$(run "$@")
  case $want in
    ok) echo "$out" | grep -q 'Total lost packets' && ! echo "$out" | grep -qE 'error [0-9]{3}' ;;
    clean) echo "$out" | grep -q 'Total lost packets 0 ' && ! echo "$out" | grep -qE 'error [0-9]{3}' ;;
    *) echo "$out" | grep -q "error $want" ;;
  esac && echo "ok    $name" || { echo "FAIL  $name"; fail=1; }
}
expect "публичный IPv4-пир разрешён" ok v4 -c -e 203.0.113.9
for ip in 10.1.2.3 100.100.100.200 127.0.0.1 169.254.169.254 172.20.0.5 192.168.1.1 198.18.0.1 240.0.0.1; do
  expect "пир $ip запрещён" 403 v4 -c -e "$ip"
done
expect "публичный IPv6-пир разрешён" ok v6 -c -x -e 2001:db8::5
for ip in ::ffff:10.1.2.3 64:ff9b::a01:203 2002:a01:203::1 fd00::5 fe80::1; do
  expect "пир $ip запрещён" 403 v6 -c -x -e "$ip"
done
expect "relay↔relay на своём адресе" clean v4 -c -y
expect "TCP-relay запрещён" 442 v4 -T
exit $fail
