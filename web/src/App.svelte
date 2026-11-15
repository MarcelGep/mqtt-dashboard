<script>
  import { fly, fade, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { live, connect, setPlug, GROUPS, groupKey } from './lib/live.svelte.js';
  import PlugCard from './lib/PlugCard.svelte';
  import Settings from './lib/Settings.svelte';
  import DeviceIcon from './lib/DeviceIcon.svelte';

  let view = $state('dashboard');
  connect();

  const total = $derived(live.plugs.length);
  const onCount = $derived(live.plugs.filter((p) => p.device?.on).length);
  const offline = $derived(live.plugs.filter((p) => !p.device || p.device.online === false).length);
  const reachable = $derived(live.plugs.filter((p) => p.device?.online));
  const status = $derived(!live.connected ? 'server' : live.mqtt.connected ? 'ok' : 'mqtt');

  const motion = (ms) => (prefersReducedMotion.current ? 0 : ms);
  const ratio = Tween.of(() => (total ? onCount / total : 0), { duration: 700, easing: cubicOut });
  const shown = Tween.of(() => onCount, { duration: 700, easing: cubicOut });

  const R = 34;
  const C = 2 * Math.PI * R;

  const headline = $derived(
    !total ? '' : onCount === 0 ? 'Alles ausgeschaltet' : onCount === total ? 'Alles eingeschaltet' : `${onCount} von ${total} eingeschaltet`
  );

  function setAll(on, list = live.plugs) {
    for (const p of list) if (p.device?.online && p.device.on !== on) setPlug(p.ip, on).catch(() => {});
  }

  // Zugeklappte Gruppen (pro Browser gemerkt)
  let collapsed = $state(loadCollapsed());
  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem('collapsedGroups')) || {}; } catch { return {}; }
  }
  function toggleGroup(key) {
    collapsed[key] = !collapsed[key];
    try { localStorage.setItem('collapsedGroups', JSON.stringify(collapsed)); } catch {}
  }

  // Gruppierung nach Gerätetyp (gleiche Definition wie in den Einstellungen)
  const groups = $derived(
    GROUPS.map((g) => {
      const plugs = live.plugs.filter((p) => groupKey(p.device) === g.key);
      return { ...g, plugs, on: plugs.filter((p) => p.device?.on).length, reachable: plugs.some((p) => p.device?.online) };
    }).filter((g) => g.plugs.length)
  );
</script>

<div class="backdrop" aria-hidden="true">
  <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
</div>

<header class="topbar">
  <div class="brand">
    <div class="logo" class:lit={onCount > 0}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
    </div>
    <div>
      <h1>Steckdosen</h1>
      <div class="badge {status}">
        <span class="pulse"></span>
        {status === 'server' ? 'Server getrennt' : status === 'ok' ? 'Live verbunden' : 'MQTT getrennt'}
      </div>
    </div>
  </div>
  <nav>
    {#if view === 'dashboard'}
      <button onclick={() => (view = 'settings')} aria-label="Einstellungen">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        <span class="lbl">Einstellungen</span>
      </button>
    {:else}
      <button onclick={() => (view = 'dashboard')}>← Dashboard</button>
    {/if}
  </nav>
</header>

<main>
  {#if live.connected && !live.mqtt.connected}
    <div class="banner" transition:fly={{ y: -10, duration: motion(250) }}>
      Keine Verbindung zum MQTT-Broker <span class="mono">{live.mqtt.url}</span>
      {#if live.mqtt.error}: <b>{live.mqtt.error}</b>{/if}
      {#if view !== 'settings'}
        <br /><button class="banner-btn" onclick={() => (view = 'settings')}>Zugangsdaten in den Einstellungen prüfen</button>
      {/if}
    </div>
  {/if}

  {#key view}
    <div in:fly={{ y: 12, duration: motion(320), easing: cubicOut }}>
      {#if view === 'dashboard'}
        {#if total}
          <section class="hero">
            <div class="meter" class:full={onCount === total}>
              <svg viewBox="0 0 80 80">
                <circle class="track" cx="40" cy="40" r={R} />
                <circle class="bar" cx="40" cy="40" r={R} stroke-dasharray={C} stroke-dashoffset={C * (1 - ratio.current)} />
              </svg>
              <div class="count"><b>{Math.round(shown.current)}</b><span>/{total}</span></div>
            </div>
            <div class="hero-text">
              <h2>{headline}</h2>
              <p class="muted">
                {#if offline}<span class="warn">{offline} nicht erreichbar</span> · {/if}Zustand wird live von den Geräten gemeldet
              </p>
            </div>
            <div class="hero-actions">
              <button class="all-on" onclick={() => setAll(true)} disabled={!reachable.length || onCount === total}>Alle an</button>
              <button onclick={() => setAll(false)} disabled={!reachable.length || onCount === 0}>Alle aus</button>
            </div>
          </section>

          {#each groups as group (group.key)}
            <section class="group {group.key}" animate:flip={{ duration: motion(300) }}>
              <div class="group-head">
                <button class="group-toggle" onclick={() => toggleGroup(group.key)} aria-expanded={!collapsed[group.key]}>
                  <span class="group-icon"><DeviceIcon kind={group.key} size={22} /></span>
                  <h3>{group.label}</h3>
                  <span class="group-count">{group.on} / {group.plugs.length} an</span>
                  {#if collapsed[group.key]}
                    <span class="mini-dots" transition:fade={{ duration: motion(200) }}>
                      {#each group.plugs as p (p.ip)}
                        <span class="mini" class:on={p.device?.on} class:off={p.device && p.device.online === false} title={p.name || p.device?.name || p.ip}></span>
                      {/each}
                    </span>
                  {/if}
                  <svg class="chevron" class:closed={collapsed[group.key]} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {#if group.key !== 'none'}
                  <div class="group-actions">
                    <button onclick={() => setAll(true, group.plugs)} disabled={!group.reachable || group.on === group.plugs.length}>An</button>
                    <button onclick={() => setAll(false, group.plugs)} disabled={!group.reachable || group.on === 0}>Aus</button>
                  </div>
                {/if}
              </div>
              {#if !collapsed[group.key]}
                <div class="grid" transition:slide={{ duration: motion(300), easing: cubicOut }}>
                  {#each group.plugs as plug, i (plug.ip)}
                    <div
                      animate:flip={{ duration: motion(300) }}
                      in:fly|global={{ y: 24, duration: motion(450), delay: motion(i * 50), easing: cubicOut }}
                    >
                      <PlugCard {plug} />
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
          {/each}
        {:else if live.connected}
          <div class="empty" in:fade={{ duration: motion(300) }}>
            <div class="empty-icon">🔌</div>
            <p>Noch keine Steckdosen eingerichtet.</p>
            <button class="primary" onclick={() => (view = 'settings')}>Steckdosen einrichten</button>
          </div>
        {/if}
      {:else}
        <Settings />
      {/if}
    </div>
  {/key}
</main>

<style>
  /* ---------- Hintergrund ---------- */
  .backdrop { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
  .blob { position: absolute; border-radius: 50%; filter: blur(80px); will-change: transform; }
  .b1 { width: 520px; height: 520px; background: var(--blob-1); top: -160px; left: -120px; animation: drift1 26s ease-in-out infinite alternate; }
  .b2 { width: 460px; height: 460px; background: var(--blob-2); bottom: -180px; right: -100px; animation: drift2 30s ease-in-out infinite alternate; }
  .b3 { width: 360px; height: 360px; background: var(--blob-3); top: 40%; left: 45%; animation: drift3 34s ease-in-out infinite alternate; }
  @keyframes drift1 { to { transform: translate(180px, 120px) scale(1.15); } }
  @keyframes drift2 { to { transform: translate(-200px, -140px) scale(1.1); } }
  @keyframes drift3 { to { transform: translate(-160px, 80px) scale(0.9); } }

  /* ---------- Kopfzeile ---------- */
  .topbar, main { max-width: 1120px; margin: 0 auto; padding: 20px; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 24px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center;
    background: var(--card); border: 1px solid var(--card-border); color: var(--muted);
    transition: color 0.4s, box-shadow 0.4s, background 0.4s;
  }
  .logo svg { width: 22px; height: 22px; }
  .logo.lit { color: #fff; background: linear-gradient(135deg, var(--on-bright), var(--on)); box-shadow: 0 8px 24px -6px var(--on); border-color: transparent; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--err); }
  .badge.ok { color: var(--on); }
  .pulse { width: 7px; height: 7px; border-radius: 50%; background: currentColor; position: relative; }
  .badge.ok .pulse::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: currentColor; animation: ping 2s ease-out infinite; }
  @keyframes ping { to { transform: scale(3); opacity: 0; } }
  nav { display: flex; gap: 8px; }
  .ico { width: 16px; height: 16px; vertical-align: -3px; }
  nav button { display: inline-flex; align-items: center; gap: 6px; }

  main { padding-top: 4px; padding-bottom: 48px; }
  .banner-btn { margin-top: 8px; color: var(--err); border-color: color-mix(in srgb, var(--err) 40%, transparent); }
  .banner { background: var(--err-soft); color: var(--err); border: 1px solid color-mix(in srgb, var(--err) 30%, transparent); padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; }

  /* ---------- Übersicht ---------- */
  .hero {
    display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    padding: 18px 22px; margin-bottom: 18px; border-radius: 20px;
    background: var(--card); border: 1px solid var(--card-border); box-shadow: var(--shadow);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  }
  .meter { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
  .meter svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: var(--line); stroke-width: 7; }
  .bar { fill: none; stroke: var(--on); stroke-width: 7; stroke-linecap: round; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--on) 60%, transparent)); }
  .meter.full .bar { animation: breathe 2.4s ease-in-out infinite; }
  @keyframes breathe { 50% { filter: drop-shadow(0 0 12px var(--on)); } }
  .count { position: absolute; inset: 0; display: grid; place-items: center; grid-auto-flow: column; align-content: center; justify-content: center; }
  .count b { font-size: 24px; font-variant-numeric: tabular-nums; }
  .count span { font-size: 13px; color: var(--muted); align-self: end; padding-bottom: 4px; }
  .hero-text { flex: 1; min-width: 180px; }
  .hero-text h2 { margin: 0 0 2px; font-size: 19px; letter-spacing: -0.01em; }
  .hero-text p { margin: 0; font-size: 13px; }
  .warn { color: var(--err); }
  .hero-actions { display: flex; gap: 8px; }
  .all-on:not(:disabled) { border-color: color-mix(in srgb, var(--on) 50%, transparent); color: var(--on); }

  /* ---------- Kacheln ---------- */
  .group { margin-bottom: 26px; }
  .group-head { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
  .group-toggle {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-align: left;
    padding: 4px 10px 4px 4px; margin-left: -4px; border: 1px solid transparent; background: none;
    backdrop-filter: none; -webkit-backdrop-filter: none; border-radius: 14px;
  }
  .group-toggle:hover:not(:disabled) { background: var(--card); border-color: var(--card-border); }
  .group-toggle:active:not(:disabled) { transform: none; }
  .chevron { width: 18px; height: 18px; margin-left: auto; color: var(--muted); flex-shrink: 0; transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .chevron.closed { transform: rotate(-90deg); }
  .mini-dots { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
  .mini { width: 8px; height: 8px; border-radius: 50%; background: var(--off); transition: background 0.3s, box-shadow 0.3s; }
  .mini.on { background: var(--on); box-shadow: 0 0 6px var(--on); }
  .mini.off { background: var(--err); }
  .group-head h3 { margin: 0; font-size: 15px; letter-spacing: 0.01em; }
  .group-icon {
    width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
    color: var(--group-color);
    background: color-mix(in srgb, var(--group-color) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--group-color) 30%, transparent);
  }
  .tasmota { --group-color: #0ea5e9; }
  .shelly { --group-color: #8b5cf6; }
  .none { --group-color: var(--err); }
  .group-count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .group-actions { margin-left: auto; display: flex; gap: 6px; }
  .group-actions button { padding: 4px 12px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .empty { text-align: center; padding: 70px 0; color: var(--muted); }
  .empty-icon { font-size: 44px; animation: bob 3s ease-in-out infinite; }
  @keyframes bob { 50% { transform: translateY(-8px); } }

  @media (max-width: 560px) {
    .topbar, main { padding-left: 16px; padding-right: 16px; }
    .lbl { display: none; }
    .grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .hero { padding: 16px; gap: 14px; }
    .hero-actions { width: 100%; }
    .hero-actions button { flex: 1; }
  }
</style>
