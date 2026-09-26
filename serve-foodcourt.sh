#!/usr/bin/env bash
# serve-foodcourt.sh — broadcast this folder's index.html on your local network
# as http://foodcourt.local (plus direct-IP fallbacks + Tailscale URL).
#
# Usage:
#   ./serve-foodcourt.sh [PORT]        # serve now (default PORT = 8080)
#   ./serve-foodcourt.sh --install     # one-time setup: permanent foodcourt.local name (needs sudo)
#   sudo ./serve-foodcourt.sh 80       # clean URL http://foodcourt.local with no port
#
# How clients reach it:
#   Same Wi-Fi/LAN  ->  http://foodcourt.local:PORT/   (after --install, see below)
#   Same Wi-Fi/LAN  ->  http://<lan-ip>:PORT/          (always works, no setup)
#   Over Tailscale  ->  http://<tailscale-ip>:PORT/    (mDNS does NOT cross Tailscale,
#                                                       Tailscale clients MUST use this IP URL)
# Stop with Ctrl+C.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="foodcourt"
FQDN="${NAME}.local"
PORT="8080"

# ---- args ----
DO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=1 ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) PORT="$arg" ;;
  esac
done

if [[ ! -f "$DIR/index.html" ]]; then
  echo "ERROR: index.html not found in $DIR" >&2
  exit 1
fi
command -v python3 >/dev/null || { echo "ERROR: python3 not found" >&2; exit 1; }

# ---- discover IPs (skip docker/virtual/loopback/cgNAT) ----
# NOTE: `hostname -I` doesn't exist on all systems, so parse `ip` output.
ALL_GLOBAL="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}' | cut -d/ -f1)"
LAN_IPS="$(echo "$ALL_GLOBAL" | awk '$1 !~ /^(docker|br-|veth|tailscale|lo)/ && $2 !~ /^(127\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.([6-9][0-9]|1[01][0-9]|12[0-7])\.)/ {print $2}' | tr '\n' ' ')"
TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
TS_IP="$(echo "$TS_IP" | tr -d '[:space:]')"

# ---- one-time install: permanent foodcourt.local via avahi hosts file ----
# (avahi-publish -a cannot alias the machine's OWN IPs — the daemon reports
#  "Local name collision" — so the supported way is /etc/avahi/hosts.)
if [[ "$DO_INSTALL" == "1" ]]; then
  if [[ -z "${LAN_IPS// }" ]]; then
    echo "ERROR: no LAN IP found, connect to Wi-Fi first." >&2
    exit 1
  fi
  echo "This will map '${FQDN}' to your current LAN IP(s) in /etc/avahi/hosts"
  echo "(persistent across reboots; re-run --install if your Wi-Fi IP changes)."
  echo "LAN IPs: $LAN_IPS"
  TMP="$(mktemp)"
  # keep existing entries, drop stale foodcourt lines, append fresh ones
  if [[ -f /etc/avahi/hosts ]]; then
    grep -v -E "[[:space:]]${NAME}([[:space:]]|\$)" /etc/avahi/hosts > "$TMP" || true
  else
    : > "$TMP"
  fi
  for ip in $LAN_IPS; do
    echo "$ip $NAME" >> "$TMP"
  done
  echo "--- new /etc/avahi/hosts (foodcourt lines) ---"
  grep -E "[[:space:]]${NAME}([[:space:]]|\$)" "$TMP" || true
  sudo cp "$TMP" /etc/avahi/hosts && rm -f "$TMP"
  echo "(avahi-daemon picks up the file automatically, no restart needed)"
  sleep 3
  # NOTE: avahi-resolve exits 0 even on failure, so check its stdout instead.
  if timeout 8 avahi-resolve -n "$FQDN" 2>/dev/null | grep -q "$FQDN"; then
    echo "SUCCESS: http://$FQDN resolves. Now run: ./serve-foodcourt.sh"
  else
    echo "WARNING: $FQDN does not resolve yet — give it a few seconds and check"
    echo "with:  avahi-resolve -n $FQDN"
    echo "If it still fails, other devices can always use the direct http://<lan-ip>:$PORT URL."
  fi
  exit 0
fi

# ---- start HTTP server (threaded, no-cache for site files) ----
python3 - "$PORT" "$DIR" <<'PY' &
import http.server, sys

port = int(sys.argv[1])
directory = sys.argv[2]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)
    def end_headers(self):
        # Never cache site files so phones see fresh edits instantly
        if self.path.split("?")[0].endswith((".html", ".htm", ".css", ".js", ".json")):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))

try:
    http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
except PermissionError:
    sys.stderr.write("ERROR: cannot bind port %d — ports <1024 need root. Try: sudo ./serve-foodcourt.sh %d\n" % (port, port))
    sys.exit(1)
except OSError as e:
    sys.stderr.write("ERROR: cannot bind port %d: %s (already in use?)\n" % (port, e))
    sys.exit(1)
PY
SERVER_PID=$!

# wait until the server answers (raw socket: unaffected by any HTTP proxy)
READY=0
for _ in $(seq 1 50); do
  if kill -0 "$SERVER_PID" 2>/dev/null && \
     python3 -c "import socket,sys; s=socket.create_connection(('127.0.0.1',int(sys.argv[1])),timeout=1); s.close()" "$PORT" 2>/dev/null; then
    READY=1
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.1
done
if [[ "$READY" != "1" ]]; then
  echo "ERROR: server failed to start on port $PORT (see message above)." >&2
  wait "$SERVER_PID" 2>/dev/null
  exit 1
fi

# ---- announce on the network ----
PIDS=()
cleanup() {
  echo ""
  echo "Stopping..."
  kill "$SERVER_PID" 2>/dev/null
  for p in ${PIDS[@]:-}; do kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  echo "Stopped."
  exit 0
}
trap cleanup INT TERM

if command -v avahi-publish >/dev/null; then
  # Browsable "FoodCourt" entry (Safari Bonjour / avahi-browse). The -H flag
  # makes the service point at foodcourt.local once --install has been run.
  avahi-publish -s "FoodCourt" _http._tcp "$PORT" -H "${FQDN}" "path=/" >/dev/null 2>&1 &
  PIDS+=($!)
  # Best-effort direct alias (works only in setups where the daemon allows it).
  for ip in $LAN_IPS; do
    avahi-publish -a "$FQDN" "$ip" >/dev/null 2>&1 &
    PIDS+=($!)
  done
else
  echo "WARNING: avahi-publish not found — install avahi-daemon for .local names:"
  echo "  sudo apt install avahi-daemon && sudo systemctl enable --now avahi-daemon"
fi

# does the pretty name actually resolve from here?
# NOTE: avahi-resolve exits 0 even on failure, so check its stdout instead.
RESOLVES=0
if timeout 6 avahi-resolve -n "$FQDN" 2>/dev/null | grep -q "$FQDN"; then
  RESOLVES=1
fi

echo "=============================================="
echo "  FoodCourt broadcaster  (serving $DIR)"
echo "=============================================="
echo ""
echo "  OPEN ON ANY DEVICE ON THE SAME WI-FI / LAN:"
if [[ "$PORT" == "80" ]]; then
  echo "    http://$FQDN/"
else
  echo "    http://$FQDN:$PORT/"
fi
if [[ "$RESOLVES" != "1" ]]; then
  echo "    ^ if that doesn't resolve, run ONE-TIME setup now or later:"
  echo "      ./serve-foodcourt.sh --install   (needs sudo, then re-run this)"
fi
for ip in $LAN_IPS; do
  echo "    http://$ip:$PORT/   (direct LAN fallback, always works)"
done
echo ""
echo "  OPEN OVER TAILSCALE (Tailscale on both ends):"
if [[ -n "${TS_IP:-}" ]]; then
  echo "    http://$TS_IP:$PORT/   <-- Tailscale clients MUST use this IP URL"
  echo "    (mDNS/.local does not cross Tailscale, so foodcourt.local won't work there)"
else
  echo "    (tailscale IP not detected — is Tailscale running?)"
fi
echo ""
echo "  Tips:"
echo "   - No port in URL?  sudo ./serve-foodcourt.sh 80  ->  http://foodcourt.local"
echo "   - Blocked?  sudo ufw allow $PORT/tcp"
echo ""
echo "Press Ctrl+C to stop broadcasting."
echo "=============================================="

wait "$SERVER_PID"
