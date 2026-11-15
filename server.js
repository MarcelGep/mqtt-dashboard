// WLAN-Steckdosen-Dashboard – Backend
// Verbindet sich mit dem MQTT-Broker, erkennt Tasmota- und Shelly-Steckdosen automatisch,
// hält ihren Zustand live und stellt eine kleine API + das Svelte-Frontend bereit.
//
// Start: npm start

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const mqtt = require('mqtt');

const PORT = Number(process.env.PORT) || 8080;
// Datenordner für settings.json (Broker) und plugs.json (Zuordnung) – im Docker-Container als Volume einhängen
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_FILE = path.join(DATA_DIR, 'plugs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_BROKER = { url: 'mqtt://192.168.178.196:1883', user: '', pass: '' };
const DIST_DIR = path.join(__dirname, 'web', 'dist');
const CLIENT_ID = 'steckdosen-dashboard-' + Math.random().toString(16).slice(2, 8);
const CONFIRM_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 60000;

// ---------------------------------------------------------------------------
// Geräte-Register
// ---------------------------------------------------------------------------
/** @type {Map<string, {id,kind,topic,ip,name,online,on,isPlug,ft?,pending?,error?}>} */
const devices = new Map();
const mqttState = { connected: false, error: null };

function getDevice(kind, topic) {
  const id = `${kind}:${topic}`;
  let d = devices.get(id);
  if (!d) {
    d = { id, kind, topic, ip: null, name: null, online: null, on: null, isPlug: false };
    devices.set(id, d);
  }
  return d;
}

function patch(d, values) {
  let changed = false;
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && d[k] !== v) { d[k] = v; changed = true; }
  }
  if (values.on !== undefined && d.pending && d.pending.on === values.on) {
    clearTimeout(d.pending.timer);
    d.pending = null;
    d.error = null;
    changed = true;
  }
  if (changed) scheduleBroadcast();
  return d;
}

function parseJson(buf) {
  try { return JSON.parse(buf.toString()); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Tasmota
// ---------------------------------------------------------------------------
function tasmotaTopic(d, prefix, cmd) {
  return (d.ft || '%prefix%/%topic%/').replace('%prefix%', prefix).replace('%topic%', d.topic) + cmd;
}

function tasmotaPower(obj) {
  const v = obj?.POWER ?? obj?.POWER1;
  return v === 'ON' ? true : v === 'OFF' ? false : undefined;
}

function tasmotaIp(s) {
  // "IPAddress1":"0.0.0.0 (192.168.178.50)" oder "IPAddress":"192.168.178.50"
  const m = typeof s === 'string' && s.match(/(\d+\.\d+\.\d+\.\d+)\)?$/);
  return m && m[1] !== '0.0.0.0' ? m[1] : undefined;
}

function matchTasmota(topic) {
  for (const d of devices.values()) {
    if (d.kind !== 'tasmota' || !d.ft) continue;
    for (const prefix of ['stat', 'tele']) {
      const b = tasmotaTopic(d, prefix, '');
      if (topic.startsWith(b)) return [d, topic.slice(b.length)];
    }
  }
  const m = topic.match(/^(stat|tele)\/([^/]+)\/([^/]+)$/);
  if (m && /^(LWT|POWER1?|STATE|RESULT|STATUS\d*|INFO2)$/.test(m[3])) return [getDevice('tasmota', m[2]), m[3]];
  return null;
}

function handleTasmota(topic, payload) {
  // Native Discovery (retained): tasmota/discovery/<MAC>/config
  if (/^tasmota\/discovery\/[^/]+\/config$/.test(topic)) {
    const c = parseJson(payload);
    if (!c?.t) return true;
    const d = getDevice('tasmota', c.t);
    const hasRelay = Array.isArray(c.rl) && c.rl.some((r) => r === 1);
    patch(d, { ip: c.ip, name: (c.fn && c.fn[0]) || c.dn || undefined, isPlug: d.isPlug || hasRelay });
    if (c.ft && c.ft !== '%prefix%/%topic%/') d.ft = c.ft;
    queryTasmota(d);
    return true;
  }

  const hit = matchTasmota(topic);
  if (!hit) return false;
  const [d, cmd] = hit;
  const text = payload.toString();

  if (cmd === 'LWT') {
    const wasUnknown = d.online === null;
    patch(d, { online: text === 'Online' });
    if (wasUnknown && d.online) queryTasmota(d);
    return true;
  }
  if (cmd === 'POWER' || cmd === 'POWER1') {
    if (text === 'ON' || text === 'OFF') patch(d, { on: text === 'ON', online: true, isPlug: true });
    return true;
  }
  const j = parseJson(payload);
  if (!j) return true;
  const power = tasmotaPower(j) ?? tasmotaPower(j.StatusSTS);
  const net = j.StatusNET || j.Info2 || j;
  patch(d, {
    on: power,
    isPlug: power !== undefined ? true : undefined,
    online: power !== undefined ? true : undefined,
    ip: tasmotaIp(net.IPAddress) ?? tasmotaIp(j.IPAddress1),
    name: (j.Status?.FriendlyName && j.Status.FriendlyName[0]) || j.Status?.DeviceName || undefined,
  });
  return true;
}

function queryTasmota(d) {
  client.publish(tasmotaTopic(d, 'cmnd', 'POWER'), '');
  if (!d.ip) client.publish(tasmotaTopic(d, 'cmnd', 'STATUS'), '5');
  if (!d.name) client.publish(tasmotaTopic(d, 'cmnd', 'STATUS'), '');
}

// ---------------------------------------------------------------------------
// Shelly Gen1  (shellies/<id>/...)
// ---------------------------------------------------------------------------
// Gen1 verschickt keinen Namen über MQTT → per HTTP (/settings) nachfragen,
// sonst aus einer selbst vergebenen MQTT-ID ableiten („shelly1_hauptschalter_außen“ → „Hauptschalter außen“).
const shelly1NameRequested = new Set();

function prettyShellyId(id) {
  if (/^shelly[\w-]*-[0-9a-f]{6,12}$/i.test(id)) return null; // Standard-ID wie shelly1-C45BBE5F7336
  const s = id.replace(/^shelly[a-z0-9]*[_-]/i, '').replace(/[_-]+/g, ' ').trim();
  if ((s.match(/\p{L}/gu) || []).length < 3) return null; // Reste wie „S 1“ sind kein sinnvoller Name
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function fetchShelly1Name(d) {
  if (!d.ip || shelly1NameRequested.has(d.id)) return;
  shelly1NameRequested.add(d.id);
  let name = null;
  try {
    const res = await fetch(`http://${d.ip}/settings`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const s = await res.json();
      name = s.name || s.relays?.[0]?.name || null;
    }
  } catch {} // Gerät nicht per HTTP erreichbar oder mit Login geschützt → Ersatzname
  patch(d, { name: name || prettyShellyId(d.topic) || undefined });
}

function handleShelly1(topic, payload) {
  const text = payload.toString();
  if (topic === 'shellies/announce' || /^shellies\/[^/]+\/announce$/.test(topic)) {
    const a = parseJson(payload);
    if (a?.id) fetchShelly1Name(patch(getDevice('shelly1', a.id), { ip: a.ip, online: true }));
    return true;
  }
  let m = topic.match(/^shellies\/([^/]+)\/relay\/0$/);
  if (m) {
    if (text === 'on' || text === 'off') patch(getDevice('shelly1', m[1]), { on: text === 'on', online: true, isPlug: true });
    return true;
  }
  m = topic.match(/^shellies\/([^/]+)\/online$/);
  if (m) { patch(getDevice('shelly1', m[1]), { online: text === 'true' }); return true; }
  return topic.startsWith('shellies/');
}

// ---------------------------------------------------------------------------
// Shelly Gen2 / Plus / Gen3  (<prefix>/online, <prefix>/status/switch:0, RPC)
// ---------------------------------------------------------------------------
let rpcId = 1;
const rpcCalls = new Map(); // id -> device

function shellyRpc(d, method, params) {
  const id = rpcId++;
  rpcCalls.set(id, d);
  setTimeout(() => rpcCalls.delete(id), 10000);
  client.publish(`${d.topic}/rpc`, JSON.stringify({ id, src: CLIENT_ID, method, params }));
}

function applyShelly2Status(d, st) {
  const sw = st?.['switch:0'];
  patch(d, {
    on: typeof sw?.output === 'boolean' ? sw.output : undefined,
    isPlug: sw ? true : undefined,
    ip: st?.wifi?.sta_ip || st?.eth?.ip || undefined,
    online: sw ? true : undefined,
  });
}

function queryShelly2(d) {
  shellyRpc(d, 'Shelly.GetStatus');
  if (!d.name) shellyRpc(d, 'Shelly.GetConfig');
}

// Antworten auf unsere RPC-Aufrufe
function handleShelly2Rpc(topic, payload) {
  if (topic !== `${CLIENT_ID}/rpc`) return false;
  const r = parseJson(payload);
  const d = r && rpcCalls.get(r.id);
  if (!d) return true;
  rpcCalls.delete(r.id);
  const res = r.result;
  if (!res) return true;
  if (res.sys?.device) patch(d, { name: res.sys.device.name || undefined }); // Shelly.GetConfig
  else if (typeof res.output === 'boolean') applyShelly2Status(d, { 'switch:0': res }); // Switch.GetStatus
  else if (!('was_on' in res)) applyShelly2Status(d, res); // Shelly.GetStatus
  return true;
}

function handleShelly2(topic, payload) {
  let m = topic.match(/^(.+)\/status\/switch:0$/);
  if (m) {
    const d = getDevice('shelly2', m[1]);
    const first = !d.isPlug;
    applyShelly2Status(d, { 'switch:0': parseJson(payload) });
    if (first) queryShelly2(d);
    return true;
  }
  m = topic.match(/^(.+)\/events\/rpc$/);
  if (m) {
    const e = parseJson(payload);
    if (e?.method === 'NotifyStatus' || e?.method === 'NotifyFullStatus') applyShelly2Status(getDevice('shelly2', m[1]), e.params);
    return true;
  }
  m = topic.match(/^([^/]+)\/online$/);
  if (m && (payload.toString() === 'true' || payload.toString() === 'false')) {
    // Kandidat – wird erst durch eine switch:0-Antwort zur Steckdose
    const d = getDevice('shelly2', m[1]);
    patch(d, { online: payload.toString() === 'true' });
    if (d.online) queryShelly2(d);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Schalten
// ---------------------------------------------------------------------------
function switchDevice(d, on) {
  if (d.pending) clearTimeout(d.pending.timer);
  d.error = null;
  d.pending = {
    on,
    timer: setTimeout(() => {
      d.pending = null;
      d.error = 'Keine Bestätigung vom Gerät';
      scheduleBroadcast();
    }, CONFIRM_TIMEOUT_MS),
  };
  if (d.kind === 'tasmota') client.publish(tasmotaTopic(d, 'cmnd', 'POWER'), on ? 'ON' : 'OFF');
  if (d.kind === 'shelly1') client.publish(`shellies/${d.topic}/relay/0/command`, on ? 'on' : 'off');
  if (d.kind === 'shelly2') {
    shellyRpc(d, 'Switch.Set', { id: 0, on });
    setTimeout(() => shellyRpc(d, 'Switch.GetStatus', { id: 0 }), 600);
  }
  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// Broker-Zugangsdaten: werden in der Oberfläche eingestellt und in settings.json gespeichert
// ---------------------------------------------------------------------------
function loadBroker() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (s.url) return { url: s.url, user: s.user || '', pass: s.pass || '' };
  } catch {}
  return { ...DEFAULT_BROKER };
}

function saveBroker(b) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(b, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(SETTINGS_FILE, 0o600);
}

// Eingabe aus der Oberfläche prüfen; leeres Passwortfeld = gespeichertes Passwort behalten
function brokerFromBody(body) {
  let url = String(body.url || '').trim();
  if (url && !/^[a-z]+:\/\//i.test(url)) url = 'mqtt://' + url;
  if (/^mqtts?:\/\/[^/:\s]+$/i.test(url)) url += url.toLowerCase().startsWith('mqtts') ? ':8883' : ':1883';
  if (!/^(mqtts?|wss?):\/\/[^\s/]+/i.test(url)) throw new Error('Ungültige Adresse – Beispiel: mqtt://192.168.178.196:1883');
  const user = String(body.user || '').trim();
  const pass = body.password ? String(body.password) : body.clearPassword ? '' : broker.pass;
  return { url, user, pass };
}

const mqttOptions = (b, id = CLIENT_ID) => ({
  clientId: id,
  username: b.user || undefined,
  password: b.pass || undefined,
  reconnectPeriod: 5000,
  connectTimeout: 5000,
});

function testBroker(b) {
  return new Promise((resolve) => {
    const c = mqtt.connect(b.url, { ...mqttOptions(b, CLIENT_ID + '-test'), reconnectPeriod: 0 });
    const done = (r) => { clearTimeout(timer); c.end(true); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: 'Zeitüberschreitung – Broker nicht erreichbar' }), 6000);
    c.on('connect', () => done({ ok: true }));
    c.on('error', (e) => done({ ok: false, error: e.message }));
  });
}

let broker = loadBroker();

// ---------------------------------------------------------------------------
// MQTT-Verbindung
// ---------------------------------------------------------------------------
let client = null;

function connectMqtt() {
  if (client) client.end(true);
  devices.clear();
  rpcCalls.clear();
  Object.assign(mqttState, { connected: false, error: null });

  const c = mqtt.connect(broker.url, mqttOptions(broker));
  client = c;
  const current = () => c === client; // Ereignisse alter Verbindungen ignorieren

  c.on('connect', () => {
    if (!current()) return;
    Object.assign(mqttState, { connected: true, error: null });
    console.log(`MQTT verbunden: ${broker.url}`);
    c.subscribe(['#', `${CLIENT_ID}/rpc`]);
    setTimeout(() => current() && discoverAll(), 1500); // erst retained Nachrichten einsammeln
    scheduleBroadcast();
  });
  c.on('close', () => {
    if (current() && mqttState.connected) { mqttState.connected = false; scheduleBroadcast(); }
  });
  c.on('error', (e) => {
    if (!current()) return;
    mqttState.error = e.message;
    console.error('MQTT-Fehler:', e.message);
    scheduleBroadcast();
  });
  c.on('message', (topic, payload) => {
    if (!current()) return;
    handleShelly2Rpc(topic, payload) || handleTasmota(topic, payload) || handleShelly1(topic, payload) || handleShelly2(topic, payload);
  });
  scheduleBroadcast();
}

function discoverAll() {
  client.publish('cmnd/tasmotas/POWER', '');
  client.publish('cmnd/tasmotas/STATUS', '5');
  shelly1NameRequested.clear(); // Namen bei jeder Suche neu holen (falls im Shelly geändert)
  client.publish('shellies/command', 'announce');
  client.publish('shellies/command', 'update');
  for (const d of devices.values()) {
    if (d.kind === 'tasmota' && d.isPlug) queryTasmota(d);
    if (d.kind === 'shelly2' && d.online !== false) queryShelly2(d);
  }
}

setInterval(() => client?.connected && discoverAll(), POLL_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Konfiguration: Liste der Steckdosen (Nummer + Name + IP), Reihenfolge = Anzeige im Dashboard
// ---------------------------------------------------------------------------
function loadConfig() {
  try {
    const list = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // "nummer" = Beschriftung auf der Steckdose (optional); ältere Dateien enthalten noch "typ" – wird ignoriert
    return list.filter((p) => p.ip).map((p) => ({ nummer: p.nummer != null ? String(p.nummer) : '', name: p.name || '', ip: p.ip }));
  } catch {
    return [];
  }
}

function saveConfig(list) {
  if (!Array.isArray(list)) throw new Error('Liste erwartet');
  const seen = new Set();
  const seenNr = new Set();
  const plugs = list.map((p) => {
    const ip = String(p.ip || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`Ungültige IP-Adresse: ${ip || '(leer)'}`);
    if (seen.has(ip)) throw new Error(`IP ${ip} ist doppelt eingetragen`);
    seen.add(ip);
    const nummer = String(p.nummer ?? '').trim();
    if (nummer.length > 8) throw new Error(`Nummer „${nummer}“ ist zu lang (max. 8 Zeichen)`);
    if (nummer && seenNr.has(nummer)) throw new Error(`Nummer ${nummer} ist doppelt vergeben`);
    if (nummer) seenNr.add(nummer);
    return { nummer, name: String(p.name || '').trim(), ip };
  }); // Reihenfolge wie in der Oberfläche festgelegt
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(plugs, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Live-Zustand an Browser (Server-Sent Events)
// ---------------------------------------------------------------------------
const publicDevice = ({ id, kind, topic, ip, name, online, on, pending, error }) =>
  ({ id, kind, topic, ip, name, online, on, pending: pending ? pending.on : null, error: error || null });

function snapshot() {
  const plugDevices = [...devices.values()].filter((d) => d.isPlug);
  return {
    mqtt: { ...mqttState, url: broker.url },
    devices: plugDevices.map(publicDevice).sort((a, b) => (a.ip || '~').localeCompare(b.ip || '~', undefined, { numeric: true })),
    plugs: loadConfig().map((p) => {
      const d = plugDevices.find((x) => x.ip === p.ip);
      return { ...p, device: d ? publicDevice(d) : null };
    }),
  };
}

const sseClients = new Set();
let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of sseClients) res.write(data);
  }, 100);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'PUT') {
      saveConfig((await readBody(req)).plugs);
      scheduleBroadcast();
      return send(res, 200, { ok: true });
    }

    // Broker-Zugangsdaten (Passwort wird nie ausgeliefert)
    if (url.pathname === '/api/broker' && req.method === 'GET') {
      return send(res, 200, { url: broker.url, user: broker.user, hasPassword: !!broker.pass });
    }
    if (url.pathname === '/api/broker' && req.method === 'PUT') {
      broker = brokerFromBody(await readBody(req));
      saveBroker(broker);
      connectMqtt();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/broker/test' && req.method === 'POST') {
      return send(res, 200, await testBroker(brokerFromBody(await readBody(req))));
    }

    if (url.pathname === '/api/discover' && req.method === 'POST') {
      if (client.connected) discoverAll();
      return send(res, 200, { ok: true });
    }

    const m = url.pathname.match(/^\/api\/plugs\/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (m && req.method === 'POST') {
      const plug = loadConfig().find((p) => p.ip === m[1]);
      if (!plug) return send(res, 404, { error: 'Steckdose nicht konfiguriert' });
      const d = [...devices.values()].find((x) => x.isPlug && x.ip === plug.ip);
      if (!d) return send(res, 409, { error: `Kein Gerät mit IP ${plug.ip} im MQTT gefunden` });
      if (!client.connected) return send(res, 503, { error: 'Keine Verbindung zum MQTT-Broker' });
      const { on } = await readBody(req);
      switchDevice(d, !!on);
      return send(res, 202, { ok: true });
    }

    // Svelte-Build ausliefern
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      let file = path.join(DIST_DIR, path.normalize(decodeURIComponent(url.pathname)));
      if (!file.startsWith(DIST_DIR)) return send(res, 404, { error: 'Nicht gefunden' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST_DIR, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Frontend nicht gebaut – bitte "npm run build" ausführen.');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Steckdosen-Dashboard: http://localhost:${PORT}`));
connectMqtt();

// ---------------------------------------------------------------------------
// Sauberes Beenden (docker stop / compose down / Ctrl+C)
// Als PID 1 im Container ignoriert Node SIGTERM sonst → Docker wartet 10 s und killt dann.
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`${signal} empfangen – beende …`);
  setTimeout(() => process.exit(0), 2000).unref(); // Notbremse, falls etwas hängt
  for (const res of sseClients) res.end(); // offene Live-Verbindungen halten server.close() sonst auf
  sseClients.clear();
  server.closeAllConnections?.();
  server.close(() => {
    if (client) client.end(false, {}, () => process.exit(0));
    else process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
