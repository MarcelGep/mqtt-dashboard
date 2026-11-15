# WLAN-Steckdosen-Dashboard

Svelte-Dashboard zum Ein- und Ausschalten von WLAN-Steckdosen über MQTT (Mosquitto), mit Live-Status.

Unterstützt werden **Tasmota**, **Shelly Gen1** und **Shelly Gen2/Plus/Gen3**. Die Geräte werden automatisch im MQTT gefunden.

## Einrichten

    npm install
    npm run build
    npm start

Dann http://localhost:8080 öffnen und auf **Einstellungen** gehen:

1. **MQTT-Broker:** Adresse, Benutzer und Passwort eintragen und auf „Speichern & verbinden“ klicken.
   Das wird in `settings.json` gespeichert (nur für dich lesbar), und das Passwort wird nie an den Browser geschickt.
2. **Steckdosen:** Die im MQTT gefundenen Geräte werden mit IP-Adresse angezeigt.
   Mit „Übernehmen“ fügst du sie hinzu, am Griff ⠿ legst du die Reihenfolge fest, dann speicherst du. Die Liste landet in `plugs.json`.

Hinweis: Das Dashboard hat keinen eigenen Login. Jeder im Heimnetz, der die Seite öffnen kann, kann schalten und die Broker-Einstellungen ändern.

## So funktioniert's

- Der Server hört auf alle MQTT-Nachrichten und leitet Zustandsänderungen sofort per Server-Sent Events an den Browser weiter.
  Wird eine Steckdose per Taster, App oder Automation geschaltet, sieht man das sofort.
- Nach einem Klick zeigt die Kachel „Schalte …“, bis das Gerät den neuen Zustand selbst meldet.
  Kommt nach 5 s keine Bestätigung, erscheint ein Fehler.
- „Offline“ kommt aus dem Last Will (Tasmota `LWT`, Shelly `online`).
- Die Steckdosen werden über ihre IP-Adresse erkannt. Feste IPs (DHCP-Reservierung in der Fritz!Box) sind deshalb sinnvoll.

## Daten

Alles, was du in der Oberfläche einstellst, liegt in zwei Dateien im Datenordner:

| Datei           | Inhalt                                    | Fehlt sie …                                                         |
|-----------------|-------------------------------------------|---------------------------------------------------------------------|
| `settings.json` | Broker-Adresse, Benutzer, Passwort        | Standard-Adresse ohne Login, Zugangsdaten in der Oberfläche eintragen |
| `plugs.json`    | Steckdosen (Nummer + Name + IP) in Anzeige-Reihenfolge | keine Steckdosen eingerichtet                                        |

Der Datenordner ist standardmäßig der Projektordner und lässt sich mit `DATA_DIR=/pfad` ändern.
Beide Dateien werden beim Speichern automatisch angelegt. Sie sind nicht nötig, um das Programm zu bauen.

## Deployment auf Unraid (Docker)

Der Container läuft als Stack im **Unraid Compose Manager**.

Einmalig:
1. Im Compose Manager einen Stack anlegen und den Inhalt von `docker-compose.yml` einfügen.
2. Vom Mac aus `npm run deploy:unraid` ausführen. Docker Desktop muss laufen, und du brauchst SSH-Zugang zu `root@unraid`.
3. Im Compose Manager „Compose Up“ klicken. Das Dashboard läuft dann auf http://unraid:8070.

Jedes Update danach: `npm run deploy:unraid`, dann im Compose Manager „Compose Down“ und „Compose Up“.
Das Skript baut nur das Image für linux/amd64 und überträgt es per SSH. Stack und Container fasst es nicht an.
Lokale `settings.json` und `plugs.json` werden nur beim ersten Mal übertragen. Was auf dem Server liegt, wird nie überschrieben.

Manuell geht es so: Image bauen, z. B. auf dem Mac, und auf den Server bringen, oder direkt auf Unraid bauen:

    docker build -t steckdosen-dashboard .

Container starten. Wichtig ist das Volume für `/data`, sonst gehen die Einstellungen bei jedem Update verloren:

    docker run -d --name steckdosen-dashboard --restart unless-stopped \
      -p 8080:8080 \
      -v /mnt/user/appdata/steckdosen-dashboard/data:/data \
      steckdosen-dashboard

Danach http://<unraid-ip>:8080 öffnen und unter Einstellungen den Broker eintragen.
Wenn du deine bisherige Einrichtung übernehmen willst, kopier vorher `settings.json` und `plugs.json` nach `/mnt/user/appdata/steckdosen-dashboard/data/`.

Update: neues Image bauen, Container löschen und mit demselben `docker run` neu starten. Die Daten im Volume bleiben erhalten.

## Entwicklung

    npm run dev:server   # Backend mit Auto-Reload (Port 8080)
    npm run dev          # Vite-Dev-Server mit Hot Reload, leitet /api an das Backend weiter

## Dateien

- `server.js`: MQTT-Anbindung, Geräteerkennung, API
- `web/src/App.svelte`: Hauptseite
- `web/src/lib/PlugCard.svelte`: Kachel einer Steckdose
- `web/src/lib/Settings.svelte`: Broker-Zugang, Steckdosen-Liste und Reihenfolge
- `web/src/lib/live.svelte.js`: Live-Zustand und API-Aufrufe
