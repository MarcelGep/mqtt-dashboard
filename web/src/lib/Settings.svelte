<script>
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion } from 'svelte/motion';
  import { live, api, kindLabel, GROUPS, groupKey } from './live.svelte.js';
  import DeviceIcon from './DeviceIcon.svelte';

  // Lokale Arbeitskopie der Steckdosen-Liste.
  // Wie im Dashboard nach Typ gruppiert; die Reihenfolge innerhalb einer Gruppe = Reihenfolge im Dashboard.
  let uid = 0;
  const withId = (p) => ({ _id: uid++, name: p.name || '', ip: p.ip || '', _group: 'none' });

  const byIp = $derived(new Map(live.devices.filter((d) => d.ip).map((d) => [d.ip, d])));
  const groupForIp = (ip) => groupKey(byIp.get(String(ip).trim()));

  // Vergleichsform „so wie das Dashboard es zeigt“ – für die Anzeige ungespeicherter Änderungen
  const canon = (list) =>
    JSON.stringify(
      GROUPS.flatMap((g) =>
        list.filter((p) => p.ip.trim() && groupForIp(p.ip) === g.key).map((p) => ({ name: p.name, ip: p.ip.trim() }))
      )
    );

  let rows = $state(live.plugs.map(withId));
  let saved = $state(live.plugs.map(({ name, ip }) => ({ name: name || '', ip })));
  let msg = $state(null);
  const dirty = $derived(canon(rows) !== canon(saved));

  const groups = $derived(
    GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r._group === g.key) })).filter((g) => g.rows.length)
  );

  // Liste in Gruppen-Reihenfolge bringen (Reihenfolge innerhalb der Gruppen bleibt erhalten)
  function ordered(list) {
    return GROUPS.flatMap((g) => list.filter((r) => r._group === g.key));
  }

  // Gruppe neu bestimmen, sobald Geräte erkannt werden oder eine IP geändert wurde –
  // die Zeile, in der gerade getippt wird, bleibt dabei stehen.
  function regroup() {
    const active = document.activeElement?.closest?.('tr[data-id]')?.dataset.id;
    for (const r of rows) if (String(r._id) !== active) r._group = groupForIp(r.ip);
    const sorted = ordered(rows);
    if (sorted.some((r, i) => r !== rows[i])) rows = sorted;
  }
  $effect(() => {
    byIp;
    untrack(regroup);
  });

  // ---------- Verschieben innerhalb einer Gruppe (Maus, Touch, Tastatur) ----------
  let tbodies = $state({});
  let dragId = $state(null);

  function startDrag(e, row) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragId = row._id;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  const groupRows = (row) => rows.filter((r) => r._group === row._group);

  function onDrag(e) {
    if (dragId === null) return;
    const row = rows.find((r) => r._id === dragId);
    const tb = tbodies[row._group];
    if (!tb) return;
    // offsetTop ist unabhängig von den Verschiebe-Animationen → kein Flackern
    const y = e.clientY - (tb.getBoundingClientRect().top - tb.offsetTop);
    let to = 0;
    for (const tr of tb.querySelectorAll('tr[data-id]')) {
      if (Number(tr.dataset.id) === dragId) continue;
      if (tr.offsetTop + tr.offsetHeight / 2 < y) to++;
    }
    if (to !== groupRows(row).indexOf(row)) move(row, to);
  }

  function endDrag() {
    dragId = null;
  }

  function move(row, to) {
    const list = groupRows(row);
    if (to < 0 || to >= list.length) return;
    list.splice(list.indexOf(row), 1);
    list.splice(to, 0, row);
    rows = GROUPS.flatMap((g) => (g.key === row._group ? list : rows.filter((r) => r._group === g.key)));
    msg = null;
  }

  function keyMove(e, row) {
    const i = groupRows(row).indexOf(row);
    if (e.key === 'ArrowUp') { e.preventDefault(); move(row, i - 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(row, i + 1); }
  }

  const assigned = $derived(new Set(rows.map((r) => r.ip.trim())));

  function add(device) {
    const row = withId({ name: device?.name, ip: device?.ip });
    row._group = groupKey(device);
    rows = ordered([...rows, row]);
    msg = null;
  }

  function remove(row) {
    rows = rows.filter((r) => r._id !== row._id);
    msg = null;
  }

  // ---------- MQTT-Broker ----------
  let broker = $state({ url: '', user: '', password: '' });
  let hasPassword = $state(false);
  let brokerMsg = $state(null);
  let brokerBusy = $state(false);

  api('/api/broker', undefined, 'GET').then((b) => {
    broker.url = b.url;
    broker.user = b.user;
    hasPassword = b.hasPassword;
  });

  async function testBroker() {
    brokerBusy = true;
    brokerMsg = { ok: null, text: 'Teste Verbindung …' };
    try {
      const r = await api('/api/broker/test', broker);
      brokerMsg = r.ok ? { ok: true, text: 'Verbindung erfolgreich ✓' } : { ok: false, text: 'Fehlgeschlagen: ' + r.error };
    } catch (e) {
      brokerMsg = { ok: false, text: e.message };
    }
    brokerBusy = false;
  }

  async function saveBroker() {
    brokerBusy = true;
    try {
      await api('/api/broker', broker, 'PUT');
      if (broker.password) hasPassword = true;
      broker.password = '';
      brokerMsg = { ok: true, text: 'Gespeichert – verbinde neu …' };
    } catch (e) {
      brokerMsg = { ok: false, text: e.message };
    }
    brokerBusy = false;
  }

  async function save() {
    try {
      regroup();
      const list = rows.filter((r) => r.ip.trim()).map(({ name, ip }) => ({ name, ip: ip.trim() }));
      await api('/api/config', { plugs: list }, 'PUT');
      saved = list;
      msg = { ok: true, text: 'Gespeichert.' };
    } catch (e) {
      msg = { ok: false, text: 'Fehler: ' + e.message };
    }
  }
</script>

<section>
  <div class="head">
    <h2>MQTT-Broker</h2>
    <span class="conn" class:ok={live.mqtt.connected}>
      <span class="dot"></span>{live.mqtt.connected ? 'verbunden' : live.mqtt.error || 'nicht verbunden'}
    </span>
  </div>
  <form class="broker" onsubmit={(e) => { e.preventDefault(); saveBroker(); }}>
    <label>
      <span>Adresse</span>
      <input class="mono" bind:value={broker.url} placeholder="mqtt://192.168.178.196:1883" autocomplete="off" />
    </label>
    <label>
      <span>Benutzer</span>
      <input bind:value={broker.user} autocomplete="username" />
    </label>
    <label>
      <span>Passwort</span>
      <input type="password" bind:value={broker.password} placeholder={hasPassword ? '•••••• gespeichert' : ''} autocomplete="current-password" />
    </label>
    <div class="actions">
      <button type="button" onclick={testBroker} disabled={brokerBusy || !broker.url}>Verbindung testen</button>
      <button type="submit" class="primary" disabled={brokerBusy || !broker.url}>Speichern & verbinden</button>
      {#if brokerMsg}<span class:ok={brokerMsg.ok === true} class:err={brokerMsg.ok === false}>{brokerMsg.text}</span>{/if}
    </div>
  </form>
  <p class="hint muted">Passwortfeld leer lassen, um das gespeicherte Passwort zu behalten.</p>
</section>

<section>
  <h2>Meine Steckdosen</h2>
  <p class="hint muted top-hint">Gruppiert wie im Dashboard. Reihenfolge innerhalb einer Gruppe am Griff <span class="grip-inline">⠿</span> verschieben (oder Griff anklicken und Pfeiltasten ↑ ↓).</p>
  <div class="table-wrap">
    <table class:sorting={dragId !== null}>
      <thead><tr><th></th><th>Name</th><th>IP-Adresse</th><th>Gerät im MQTT</th><th></th></tr></thead>
      {#each groups as g (g.key)}
      <tbody bind:this={tbodies[g.key]} class="grp {g.key}">
        <tr class="group-row">
          <td colspan="5">
            <span class="gicon"><DeviceIcon kind={g.key} size={16} /></span>
            {g.key === 'none' ? 'Neu oder nicht gefunden' : g.label}
            <span class="gcount">{g.rows.length}</span>
          </td>
        </tr>
        {#each g.rows as row (row._id)}
          {@const dev = byIp.get(row.ip.trim())}
          <tr data-id={row._id} class:dragging={dragId === row._id} animate:flip={{ duration: prefersReducedMotion.current ? 0 : 200 }}>
            <td class="grip-cell">
              <button
                class="grip"
                title="Ziehen zum Verschieben"
                aria-label="{row.name || row.ip || 'Steckdose'} verschieben (Pfeiltasten)"
                onpointerdown={(e) => startDrag(e, row)}
                onpointermove={onDrag}
                onpointerup={endDrag}
                onpointercancel={endDrag}
                onkeydown={(e) => keyMove(e, row)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
                  <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                  <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              </button>
            </td>
            <td><input bind:value={row.name} placeholder={dev?.name || 'z. B. Wohnzimmer'} /></td>
            <td><input class="mono" bind:value={row.ip} list="ips" placeholder="192.168.178.…" onchange={() => queueMicrotask(regroup)} /></td>
            <td>
              {#if !row.ip.trim()}<span class="muted">–</span>
              {:else if dev}<span class="found">✓ {dev.name || dev.topic}</span> <span class="muted mono">{kindLabel[dev.kind]}</span>
              {:else}<span class="notfound">nicht gefunden</span>{/if}
            </td>
            <td><button title="Entfernen" onclick={() => remove(row)}>✕</button></td>
          </tr>
        {/each}
      </tbody>
      {:else}
        <tbody><tr><td colspan="5" class="muted">Noch keine Einträge – unten ein gefundenes Gerät übernehmen oder manuell hinzufügen.</td></tr></tbody>
      {/each}
    </table>
  </div>
  <datalist id="ips">
    {#each live.devices.filter((d) => d.ip) as d}<option value={d.ip}>{d.name || d.topic}</option>{/each}
  </datalist>
  <div class="actions">
    <button onclick={() => add()}>+ Manuell hinzufügen</button>
    <button class="primary" onclick={save} disabled={!dirty}>Speichern</button>
    {#if msg}<span class:ok={msg.ok} class:err={!msg.ok}>{msg.text}</span>
    {:else if dirty}<span class="unsaved">● Ungespeicherte Änderungen</span>{/if}
  </div>
</section>

<section>
  <div class="head">
    <h2>Im MQTT gefundene Steckdosen ({live.devices.length})</h2>
    <button onclick={() => api('/api/discover')} disabled={!live.mqtt.connected}>Neu suchen</button>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>IP-Adresse</th><th>Name</th><th>MQTT-Topic</th><th>Typ</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each live.devices as d (d.id)}
          <tr>
            <td class="mono">{d.ip || '…'}</td>
            <td>{d.name || '–'}</td>
            <td class="mono muted">{d.topic}</td>
            <td>{kindLabel[d.kind]}</td>
            <td>{d.online === false ? 'offline' : d.on ? 'an' : d.on === false ? 'aus' : '?'}</td>
            <td>
              {#if assigned.has(d.ip)}<span class="muted">zugeordnet</span>
              {:else}<button disabled={!d.ip} onclick={() => add(d)}>Übernehmen</button>{/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">{live.mqtt.connected ? 'Suche läuft … noch keine Steckdosen gefunden.' : 'Keine Verbindung zum MQTT-Broker.'}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  section { margin-bottom: 28px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .head h2 { margin: 0; }
  .table-wrap {
    overflow-x: auto; border: 1px solid var(--card-border); border-radius: 16px; background: var(--card);
    box-shadow: var(--shadow); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  }
  tbody tr { transition: background 0.2s, box-shadow 0.2s; }
  .grip-cell { width: 36px; padding-right: 0; }
  .grip {
    width: 28px; height: 32px; padding: 0; display: grid; place-items: center;
    border: none; background: none; backdrop-filter: none; -webkit-backdrop-filter: none;
    color: var(--muted); cursor: grab; touch-action: none; border-radius: 8px;
  }
  .grip svg { width: 18px; height: 18px; }
  .grip:hover:not(:disabled) { color: var(--text); background: var(--btn); }
  .grip:active:not(:disabled) { transform: none; }
  .sorting, .sorting * { cursor: grabbing !important; user-select: none; }
  tr.dragging {
    position: relative; z-index: 1;
    background: var(--bg-solid);
    box-shadow: 0 10px 28px -10px rgba(0, 0, 0, 0.45), inset 3px 0 0 var(--accent);
  }
  tr.dragging .grip { color: var(--accent); }
  .grp.tasmota { --group-color: #0ea5e9; }
  .grp.shelly { --group-color: #8b5cf6; }
  .grp.none { --group-color: var(--err); }
  tbody + tbody .group-row td { border-top: 1px solid var(--line); }
  .group-row td {
    font-size: 13px; font-weight: 650; padding: 8px 12px;
    background: color-mix(in srgb, var(--group-color) 8%, transparent);
  }
  .group-row:hover { background: none; }
  .gicon { display: inline-grid; vertical-align: -3px; margin-right: 6px; color: var(--group-color); }
  .gcount { margin-left: 6px; font-weight: 500; color: var(--muted); font-size: 12px; }
  .top-hint { margin: -4px 2px 10px; }
  .grip-inline { font-size: 14px; }
  .unsaved { color: var(--warn); font-size: 13px; }
  tbody tr:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; }
  td:nth-child(3) input { min-width: 150px; }
  .found, .ok { color: var(--on); }
  .notfound, .err { color: var(--err); }
  .actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
  .broker {
    display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; padding: 16px;
    border: 1px solid var(--card-border); border-radius: 16px; background: var(--card);
    box-shadow: var(--shadow); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  }
  .broker label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
  .broker .actions { grid-column: 1 / -1; margin-top: 0; }
  .hint { font-size: 12px; margin: 8px 2px 0; }
  .conn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--err); }
  .conn.ok { color: var(--on); }
  .conn .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  @media (max-width: 700px) { .broker { grid-template-columns: 1fr; } }
</style>
