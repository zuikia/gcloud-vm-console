function shellSingle(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

const STATUS_SCRIPT = String.raw`set -u
safe() { printf '%s' "$1" | tr -cd '[:alnum:].:_+-'; }
setting_json="$(sudo -n warp-cli --json settings list 2>/dev/null || true)"
registration_json="$(sudo -n warp-cli --json registration show 2>/dev/null || true)"
status_text="$(sudo -n warp-cli --no-ansi status 2>/dev/null || true)"
service="$(systemctl is-active warp-svc 2>/dev/null || true)"
cli_version="$(sudo -n warp-cli --version 2>/dev/null | awk '{print $NF}' | head -1)"
mode="$(printf '%s' "$setting_json" | jq -r '.settings.operation_mode // empty' 2>/dev/null || true)"
proxy_port="$(printf '%s' "$setting_json" | jq -r '.settings.proxy_port // empty' 2>/dev/null || true)"
protocol="$(printf '%s' "$setting_json" | jq -r '.settings.warp_tunnel_protocol // empty' 2>/dev/null || true)"
tier="$(printf '%s' "$registration_json" | jq -r '.account.type // empty' 2>/dev/null || true)"
connection=unknown
printf '%s' "$status_text" | grep -qi 'Status update: Connected' && connection=connected
printf '%s' "$status_text" | grep -qi 'Status update: Disconnected' && connection=disconnected
network="$(printf '%s\n' "$status_text" | awk -F': *' 'tolower($1)=="network" {print tolower($2); exit}')"
listener=missing
if [ -n "$proxy_port" ] && ss -H -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "^(127\\.0\\.0\\.1|\\[::1\\]):$proxy_port$"; then listener=loopback; fi
route_server=
route_port=
affected_count=0
for config in /opt/sing-box/config.json /etc/sing-box/config.json /usr/local/etc/sing-box/config.json /etc/sing-box-plus/config.json; do
  if sudo -n test -r "$config"; then
    route_server="$(sudo -n jq -r '[.outbounds[]? | select(.tag == "warp" and .type == "socks")][0].server // empty' "$config" 2>/dev/null || true)"
    route_port="$(sudo -n jq -r '[.outbounds[]? | select(.tag == "warp" and .type == "socks")][0].server_port // empty' "$config" 2>/dev/null || true)"
    affected_count="$(sudo -n jq -r '[.route.rules[]? | select(.outbound == "warp") | .inbound[]? | select(type == "string" and test("warp$"; "i"))] | unique | length' "$config" 2>/dev/null || printf 0)"
    break
  fi
done
trace4=
trace6=
if [ "$listener" = loopback ]; then
  trace4="$(curl -4 -fsS --max-time 10 --proxy "socks5://127.0.0.1:$proxy_port" https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null || true)"
  trace6="$(curl -6 -fsS --max-time 10 --proxy "socks5://127.0.0.1:$proxy_port" https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null || true)"
fi
trace_value() { printf '%s\n' "$1" | awk -F= -v key="$2" '$1==key {print $2; exit}'; }
printf '%s\n' '__GVC_WARP_STATUS__'
printf 'service=%s\n' "$(safe "$service")"
printf 'cli_version=%s\n' "$(safe "$cli_version")"
printf 'mode=%s\n' "$(safe "$mode")"
printf 'proxy_port=%s\n' "$(safe "$proxy_port")"
printf 'protocol=%s\n' "$(safe "$protocol")"
printf 'tier=%s\n' "$(safe "$tier")"
printf 'connection=%s\n' "$(safe "$connection")"
printf 'network=%s\n' "$(safe "$network")"
printf 'listener=%s\n' "$(safe "$listener")"
printf 'route_server=%s\n' "$(safe "$route_server")"
printf 'route_port=%s\n' "$(safe "$route_port")"
printf 'affected_count=%s\n' "$(safe "$affected_count")"
printf 'ipv4=%s\n' "$(safe "$(trace_value "$trace4" ip)")"
printf 'ipv4_colo=%s\n' "$(safe "$(trace_value "$trace4" colo)")"
printf 'ipv4_warp=%s\n' "$(safe "$(trace_value "$trace4" warp)")"
printf 'ipv6=%s\n' "$(safe "$(trace_value "$trace6" ip)")"
printf 'ipv6_colo=%s\n' "$(safe "$(trace_value "$trace6" colo)")"
printf 'ipv6_warp=%s\n' "$(safe "$(trace_value "$trace6" warp)")"
printf '%s\n' '__GVC_WARP_END__'`;

const RECONNECT_SCRIPT = String.raw`set -u
connected() { sudo -n warp-cli --no-ansi status 2>/dev/null | grep -qi 'Status update: Connected'; }
restore() { sudo -n warp-cli connect >/dev/null 2>&1 || true; }
printf '%s\n' '__GVC_WARP_RECONNECT__'
initial=unknown
connected && initial=connected
if [ "$initial" = unknown ] && sudo -n warp-cli --no-ansi status 2>/dev/null | grep -qi 'Status update: Disconnected'; then initial=disconnected; fi
printf 'initial=%s\n' "$initial"
if [ "$initial" = unknown ]; then printf 'final=unknown\n%s\n' '__GVC_WARP_END__'; exit 1; fi
trap restore EXIT HUP INT TERM
if [ "$initial" = connected ]; then
  sudo -n warp-cli disconnect >/dev/null 2>&1
  disconnected=0
  for _ in $(seq 1 15); do if ! connected; then disconnected=1; break; fi; sleep 1; done
  if [ "$disconnected" -ne 1 ]; then printf 'disconnect=failed\nfinal=connected\n%s\n' '__GVC_WARP_END__'; exit 1; fi
  printf 'disconnect=done\nhold=5\n'
  sleep 5
else
  printf 'disconnect=skipped\nhold=0\n'
fi
sudo -n warp-cli connect >/dev/null 2>&1 || true
printf 'connect=done\n'
final=disconnected
for _ in $(seq 1 45); do if connected; then final=connected; break; fi; sleep 1; done
printf 'final=%s\n%s\n' "$final" '__GVC_WARP_END__'
if [ "$final" = connected ]; then trap - EXIT HUP INT TERM; exit 0; fi
exit 1`;

export const WARP_STATUS_COMMAND = `bash -lc ${shellSingle(STATUS_SCRIPT)}`;
export const WARP_RECONNECT_COMMAND = `bash -lc ${shellSingle(RECONNECT_SCRIPT)}`;

export function contractForWarpOperation(operation) {
  if (operation === "status") return WARP_STATUS_COMMAND;
  if (operation === "reconnect") return WARP_RECONNECT_COMMAND;
  throw new Error("不支持的 WARP 远端操作。");
}
