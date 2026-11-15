#!/usr/bin/env bash
# Baut das Image auf dem Mac und lädt es auf Unraid. Container und Stack fasst das Skript
# nicht an – den Stack startest du selbst im Compose Manager (Inhalt siehe docker-compose.yml).
#
# Aufruf: npm run deploy:unraid   (anderer Host: UNRAID_HOST=root@192.168.178.x npm run deploy:unraid)
set -euo pipefail

HOST="${UNRAID_HOST:-root@unraid}"
DATA_DIR="/mnt/user/appdata/steckdosen-dashboard/data"
IMAGE="steckdosen-dashboard:latest"

cd "$(dirname "$0")"

echo "==> Image bauen (linux/amd64)"
docker build --platform linux/amd64 -t "$IMAGE" .

echo "==> Image nach Unraid übertragen"
docker save "$IMAGE" | gzip | ssh "$HOST" docker load

# Einstellungen nur übertragen, wenn sie auf Unraid noch nicht existieren –
# bestehende Daten auf dem Server werden nie überschrieben.
ssh "$HOST" "mkdir -p '$DATA_DIR'"
for f in settings.json plugs.json; do
  if [ -f "$f" ]; then
    rsync -a --ignore-existing "$f" "$HOST:$DATA_DIR/"
  fi
done

echo "==> Fertig. Image ist auf Unraid geladen."
echo "    Jetzt den Stack im Compose Manager neu erstellen (Compose Down + Compose Up)."