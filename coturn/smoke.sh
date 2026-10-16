#!/bin/sh
# Проверка защиты relay на живом coturn: после любой правки turnserver.conf или флагов compose.
#   coturn/smoke.sh <контейнер coturn> [секрет]      (секрет по умолчанию — dev из compose)
# Клиент — turnutils_uclient из того же образа, сервер — адрес контейнера (relay на нём).
# Ждём: публичный пир (TEST-NET-3, пакеты никуда не уходят) — без 403; частный — 403;
# relay↔relay (-y) — без потерь; TCP-relay — 442.
set -u
C=${1:?контейнер coturn}
SECRET=${2:-dev-turn-secret-change-me}
fail=0 n=0
# Имя на каждый запуск своё: квота считается по имени, аллокации живут 600 с после выхода.
run() { n=$((n + 1)); docker exec "$C" sh -c 's=$0 u=$1; shift; turnutils_uclient -W "$s" -u "$u" -n 2 "$@" "$(hostname -i | cut -d" " -f1)" 2>&1' "$SECRET" "smoke-$$-$n" "$@"; }
expect() { # имя, шаблон, который должен (has) или не должен (no) встретиться, аргументы uclient…
  name=$1 mode=$2 pat=$3; shift 3
  if run "$@" | grep -qE "$pat"; then got=has; else got=no; fi
  if [ "$got" = "$mode" ]; then echo "ok    $name"; else echo "FAIL  $name"; fail=1; fi
}
expect "публичный пир разрешён" no 'error 403|error 486' -c -e 203.0.113.9
for ip in 10.1.2.3 100.100.100.200 127.0.0.1 169.254.169.254 172.20.0.5 192.168.1.1 198.18.0.1; do
  expect "пир $ip запрещён" has 'error 403' -c -e "$ip"
done
expect "relay↔relay на своём адресе" has 'Total lost packets 0 ' -c -y
expect "TCP-relay запрещён" has 'error 442' -T
exit $fail
