<script>
  // Eigene, markenneutrale Gerätesymbole.
  // kind: 'tasmota' → WLAN-Steckdose, 'shelly' | 'shelly1' | 'shelly2' → Relais-Modul
  let { kind, size = 20 } = $props();
  const type = $derived(kind?.startsWith('shelly') ? 'shelly' : kind === 'tasmota' ? 'tasmota' : 'unknown');
</script>

<svg
  class="device-icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if type === 'tasmota'}
    <!-- WLAN-Steckdose: Gehäuse mit Schuko-Buchse und Funkwellen -->
    <rect x="2" y="8" width="13.5" height="14" rx="3.5" />
    <circle cx="8.75" cy="15" r="3.6" />
    <circle cx="7.4" cy="15" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="10.1" cy="15" r="0.8" fill="currentColor" stroke="none" />
    <path d="M17 4.4A2.6 2.6 0 0 1 19.6 7" />
    <path d="M17 1.8A5.2 5.2 0 0 1 22.2 7" />
    <circle cx="17" cy="7" r="0.9" fill="currentColor" stroke="none" />
  {:else if type === 'shelly'}
    <!-- Relais-Modul: Gehäuse, Klemmleiste unten, Status-LED -->
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M3 15h18" />
    <circle cx="7.5" cy="18" r="0.9" />
    <circle cx="12" cy="18" r="0.9" />
    <circle cx="16.5" cy="18" r="0.9" />
    <path d="M6.8 8h5.5" />
    <path d="M6.8 11h3.5" />
    <circle class="led" cx="16.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
  {:else}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
  {/if}
</svg>

<style>
  .device-icon { display: block; flex-shrink: 0; }
  .led { fill: var(--on); }
</style>
