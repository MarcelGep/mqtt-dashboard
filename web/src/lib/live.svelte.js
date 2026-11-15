// Live-Zustand vom Server (Server-Sent Events) – alle Komponenten lesen von hier.
export const live = $state({
  connected: false,
  mqtt: { connected: false, error: null, url: '' },
  devices: [],
  plugs: [],
});

export function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => (live.connected = true);
  es.onerror = () => (live.connected = false); // EventSource verbindet sich selbst neu
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    live.mqtt = data.mqtt;
    live.devices = data.devices;
    live.plugs = data.plugs;
    live.connected = true;
  };
}

export async function api(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const setPlug = (ip, on) => api(`/api/plugs/${ip}`, { on });

export const kindLabel = { tasmota: 'Tasmota', shelly1: 'Shelly Gen1', shelly2: 'Shelly Gen2+' };

// Gruppierung nach Gerätetyp – gemeinsam für Dashboard und Einstellungen
export const GROUPS = [
  { key: 'tasmota', label: 'Tasmota' },
  { key: 'shelly', label: 'Shelly' },
  { key: 'none', label: 'Nicht gefunden' },
];
export const groupKey = (device) => (!device ? 'none' : device.kind === 'tasmota' ? 'tasmota' : 'shelly');
