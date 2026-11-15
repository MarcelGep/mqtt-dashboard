<script>
  import { scale, slide } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';
  import { setPlug, kindLabel } from './live.svelte.js';
  import DeviceIcon from './DeviceIcon.svelte';

  let { plug } = $props();
  let requestError = $state(null);
  let ripples = $state([]);
  let rippleId = 0;

  const d = $derived(plug.device);
  const status = $derived(
    !d ? 'missing' : d.online === false ? 'offline' : d.pending !== null ? 'pending' : d.on ? 'on' : d.on === false ? 'off' : 'unknown'
  );
  const label = {
    missing: 'Nicht gefunden',
    offline: 'Offline',
    pending: 'Schalte …',
    on: 'An',
    off: 'Aus',
    unknown: 'Unbekannt',
  };
  const canSwitch = $derived(d && d.online !== false && status !== 'pending');
  const error = $derived(requestError || d?.error);
  const name = $derived(plug.name || d?.name || plug.ip);
  const ms = (v) => (prefersReducedMotion.current ? 0 : v);

  async function toggle(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const id = rippleId++;
    const keyboard = e.detail === 0;
    ripples.push({ id, x: keyboard ? r.width / 2 : e.clientX - r.left, y: keyboard ? r.height / 2 : e.clientY - r.top });
    setTimeout(() => (ripples = ripples.filter((x) => x.id !== id)), 700);

    requestError = null;
    try {
      await setPlug(plug.ip, !d.on);
    } catch (err) {
      requestError = err.message;
    }
  }
</script>

<article class="card {status}">
  <div class="glow" aria-hidden="true"></div>

  <div class="head">
    <span class="num"><DeviceIcon kind={d?.kind} size={18} /></span>
    <span class="pill"><span class="dot"></span>{label[status]}</span>
  </div>

  <div class="center">
    <button class="power" disabled={!canSwitch} onclick={toggle} aria-label="{name} {d?.on ? 'ausschalten' : 'einschalten'}" aria-pressed={!!d?.on}>
      <span class="ring" aria-hidden="true"></span>
      <span class="clip" aria-hidden="true">
        {#each ripples as r (r.id)}
          <span class="ripple" style="left:{r.x}px; top:{r.y}px"></span>
        {/each}
      </span>
      {#key status === 'on'}
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" in:scale={{ start: 0.6, duration: ms(380), easing: backOut }}>
          <path d="M12 3v9" />
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        </svg>
      {/key}
    </button>
  </div>

  <div class="foot">
    <div class="name" title={name}>{name}</div>
    <div class="meta">
      <span class="mono">{plug.ip}</span>
      {#if d}<span class="type {d.kind}" title={kindLabel[d.kind]}>{d.kind === 'tasmota' ? 'Tasmota' : 'Shelly'}</span>{/if}
    </div>
  </div>

  {#if error}
    <div class="error" transition:slide={{ duration: ms(200) }}>{error}</div>
  {/if}
</article>

<style>
  .card {
    position: relative; overflow: hidden; isolation: isolate;
    display: flex; flex-direction: column; gap: 14px; padding: 16px;
    border-radius: 20px; background: var(--card); border: 1px solid var(--card-border);
    box-shadow: var(--shadow);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.25s, border-color 0.4s, opacity 0.3s, filter 0.3s;
  }
  .card:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }

  /* Leuchten im Hintergrund, wenn eingeschaltet */
  .glow {
    position: absolute; inset: -40% -20% auto; height: 120%; z-index: -1;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--on) 28%, transparent), transparent);
    opacity: 0; transform: scale(0.6); transition: opacity 0.6s ease, transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .on .glow { opacity: 1; transform: scale(1); }
  .on { border-color: color-mix(in srgb, var(--on) 35%, transparent); }
  .offline { filter: saturate(0.4); opacity: 0.75; }
  .missing { border-style: dashed; border-color: color-mix(in srgb, var(--err) 45%, transparent); opacity: 0.8; }

  .head { display: flex; align-items: center; justify-content: space-between; }
  .num {
    width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center;
    background: var(--btn); color: var(--muted);
    transition: background 0.4s, color 0.4s;
  }
  .on .num { background: var(--on-soft); color: var(--on); }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: 99px; background: var(--btn); color: var(--muted);
    transition: background 0.4s, color 0.4s;
  }
  .on .pill { background: var(--on-soft); color: var(--on); }
  .offline .pill, .missing .pill { background: var(--err-soft); color: var(--err); }
  .pending .pill { color: var(--warn); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .pending .dot { animation: blink 0.8s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: 0.2; } }

  /* ---------- Power-Knopf ---------- */
  .center { display: grid; place-items: center; padding: 6px 0; }
  .power {
    position: relative; width: 92px; height: 92px; border-radius: 50%; padding: 0;
    display: grid; place-items: center; border: 1px solid var(--card-border);
    background: var(--btn); color: var(--muted); backdrop-filter: none;
    transition: transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1), background 0.4s, color 0.4s, box-shadow 0.5s;
  }
  .power:hover:not(:disabled) { transform: scale(1.05); border-color: var(--card-border); }
  .power:active:not(:disabled) { transform: scale(0.92); }
  .power:disabled { opacity: 0.55; }
  .icon { width: 36px; height: 36px; position: relative; z-index: 1; }

  .on .power {
    color: #fff; border-color: transparent;
    background: radial-gradient(circle at 50% 30%, var(--on-bright), var(--on) 70%);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--on) 14%, transparent), 0 14px 40px -8px var(--on);
  }
  .on .icon { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.7)); }

  /* Wellen, die vom eingeschalteten Knopf ausgehen */
  .on .power::before, .on .power::after {
    content: ""; position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid var(--on); animation: wave 2.8s ease-out infinite; pointer-events: none;
  }
  .on .power::after { animation-delay: 1.4s; }
  @keyframes wave { from { transform: scale(1); opacity: 0.55; } to { transform: scale(1.75); opacity: 0; } }

  /* Umlaufender Lichtring (an) bzw. Ladering (schaltet) */
  .ring { position: absolute; inset: -7px; border-radius: 50%; pointer-events: none; opacity: 0; transition: opacity 0.4s; }
  .on .ring, .pending .ring {
    opacity: 1;
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
  }
  .on .ring { background: conic-gradient(from var(--angle), transparent 0 65%, var(--on-bright) 88%, transparent); animation: spin 3.5s linear infinite; }
  .pending .ring { background: conic-gradient(from var(--angle), transparent 0 55%, var(--warn)); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { --angle: 360deg; } }

  /* Klick-Welle */
  .clip { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; }
  .ripple {
    position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
    background: currentColor; opacity: 0.35; animation: ripple 0.7s ease-out forwards;
  }
  @keyframes ripple { to { transform: scale(22); opacity: 0; } }

  /* ---------- Fuß ---------- */
  .foot { text-align: center; min-width: 0; }
  .name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta {
    color: var(--muted); margin-top: 6px;
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  .type {
    font-size: 11px; font-weight: 600; white-space: nowrap;
    padding: 1px 8px; border-radius: 99px; border: 1px solid var(--line); background: var(--btn);
  }
  .type.tasmota { color: #0ea5e9; }
  .type.shelly1, .type.shelly2 { color: #8b5cf6; }
  .error { font-size: 12px; color: var(--err); background: var(--err-soft); padding: 6px 8px; border-radius: 8px; text-align: center; }

  @media (max-width: 560px) {
    .card { padding: 12px; gap: 10px; border-radius: 16px; }
    .power { width: 76px; height: 76px; }
    .icon { width: 30px; height: 30px; }
  }
</style>
