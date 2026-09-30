#!/usr/bin/env bash
# Prove gateway cold start and Docker DNS recovery without a database or app
# build. Each service is an HTTP responder; replacing it must change its IP.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
prefix="ciele-gateway-smoke-$$"
network="$prefix"
image=$(sed -n 's/^    image: \(nginx:.*\)/\1/p' "$here/docker-compose.yml")
containers=()
cleanup() {
  for container in "${containers[@]}"; do
    docker rm -f "$container" >/dev/null 2>&1 || true
  done
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

cat > "$work/responder.conf" <<'NGINX'
server {
    listen 9999;
    listen 3000;
    listen 5000;
    location / {
        return 200 "$request_method|$request_uri|$http_authorization|$http_apikey";
    }
}
NGINX

docker pull "$image" >/dev/null
docker network create "$network" >/dev/null
# Older Docker runners require an explicitly configured subnet for --ip.
# Reuse the free subnet Docker selected instead of hard-coding one that
# could overlap another network on a developer's machine.
subnet=$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "$network")
docker network rm "$network" >/dev/null
docker network create --subnet "$subnet" "$network" >/dev/null
gateway="$prefix-gateway"
containers+=("$gateway")
docker create --name "$gateway" --network "$network" \
  -p 127.0.0.1::8000 "$image" >/dev/null
docker cp "$here/gateway.conf" "$gateway:/etc/nginx/conf.d/default.conf"
docker start "$gateway" >/dev/null
port=$(docker port "$gateway" 8000/tcp | sed 's/.*://')
origin="http://127.0.0.1:$port"
gateway_id=$(docker inspect --format '{{.Id}}' "$gateway")

# All three DNS records are absent at nginx start. The process must stay up.
sleep 2
test "$(docker inspect --format '{{.State.Running}}' "$gateway")" = true
echo "Gateway starts with all upstream DNS records absent."

start_service() {
  local service="$1" container="$prefix-$1"
  containers+=("$container")
  docker create --name "$container" --network "$network" \
    --network-alias "$service" "$image" >/dev/null
  docker cp "$work/responder.conf" "$container:/etc/nginx/conf.d/default.conf"
  docker start "$container" >/dev/null
}

probe() {
  local service="$1" response expected
  expected='POST|/probe?select=id%2Cname&name=eq.a%20b|Bearer smoke-token|smoke-key'
  for _ in $(seq 1 40); do
    response=$(curl --max-time 2 -fsS -X POST \
      -H 'Authorization: Bearer smoke-token' -H 'apikey: smoke-key' \
      --data 'probe=body' "$origin/$service/v1/probe?select=id%2Cname&name=eq.a%20b" 2>/dev/null || true)
    if [ "$response" = "$expected" ]; then return; fi
    sleep 1
  done
  echo "Gateway $service route failed: $response" >&2
  docker logs "$gateway" >&2
  return 1
}

for service in auth rest storage; do start_service "$service"; done
for service in auth rest storage; do probe "$service"; done
echo "All routes recover after cold start; prefix, query, method and headers are preserved."

for service in auth rest storage; do
  container="$prefix-$service"
  old_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
  docker rm -f "$container" >/dev/null
  # Occupy the old address so Docker cannot give it straight back. This
  # catches a static proxy_pass that otherwise passes a recreation test.
  holder="$prefix-hold-$service"
  containers+=("$holder")
  docker run -d --name "$holder" --network "$network" --ip "$old_ip" \
    "$image" sleep 300 >/dev/null
  start_service "$service"
  new_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
  test "$old_ip" != "$new_ip"
  probe "$service"
  echo "$service recovers after IP change: $old_ip -> $new_ip."
done

test "$(docker inspect --format '{{.Id}}' "$gateway")" = "$gateway_id"
test "$(docker inspect --format '{{.RestartCount}}' "$gateway")" = 0
test "$(curl --max-time 2 -sS -o /dev/null -w '%{http_code}' "$origin/unmatched")" = 404
echo "Gateway recovered without restart; unmatched routes remain 404."
