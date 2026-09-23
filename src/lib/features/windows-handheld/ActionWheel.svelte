<script lang="ts">
  export interface WheelEntry { id: string; label: string; enabled: boolean; pending?: boolean; run: () => void | Promise<void> }
  let { title, entries, activeIndex, onselect, onrun, onclose, compact = false, ref = $bindable() }:
    { title: string; entries: WheelEntry[]; activeIndex: number; onselect: (index: number) => void;
      onrun: (entry: WheelEntry) => void; onclose: () => void; compact?: boolean; ref?: HTMLElement } = $props();
</script>

<div class="wheel-backdrop" bind:this={ref} role="dialog" aria-modal="true" aria-label={`${title} 的快捷操作`} tabindex="-1" onkeydown={event => { if (event.key === "Escape") { event.preventDefault(); onclose(); } }}>
  <div class="wheel-head"><span>QUICK ACTION / 作品操作</span><strong>{title}</strong><button onclick={onclose} aria-label="关闭操作轮盘">×</button></div>
  {#if compact}
    <div class="wheel-list">{#each entries as entry, index (entry.id)}<button class:active={activeIndex === index} disabled={!entry.enabled || entry.pending} onclick={() => onrun(entry)} onfocus={() => onselect(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{entry.pending ? "执行中…" : entry.label}</strong><span aria-hidden="true">↗</span></button>{/each}</div>
  {:else}
    <div class="wheel-circle"><div class="wheel-center"><small>MOEPLAY</small><strong>{title}</strong><span>方向键选择 · A 执行</span></div>
      {#each entries as entry, index (entry.id)}<button class="wheel-action" class:active={activeIndex === index} style={`--wheel-angle:${index * 60 - 90}deg`} disabled={!entry.enabled || entry.pending} onclick={() => onrun(entry)} onfocus={() => onselect(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{entry.pending ? "执行中…" : entry.label}</strong></button>{/each}</div>
  {/if}
  <p>触摸可直接选择 · B 返回</p>
</div>

<style>
  .wheel-backdrop {position:absolute;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;flex-direction:column;background:#101116;color:#f5f0e7;}
  .wheel-head {position:absolute;top:20px;left:24px;right:24px;display:flex;align-items:center;gap:16px;border-bottom:2px solid var(--hh-accent);padding-bottom:10px;}.wheel-head span {font:750 11px var(--font-mono,monospace);letter-spacing:.15em;color:var(--hh-accent);}.wheel-head strong {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.wheel-head button {margin-left:auto;min-width:44px;min-height:44px;font-size:28px;background:#f1ede312;border:1px solid #f1ede34d;color:#f5f0e7;border-radius:3px;cursor:pointer;}
  .wheel-circle {position:relative;width:min(66vh,500px);height:min(66vh,500px);min-width:280px;min-height:280px;border:1px solid #f4f0e43c;border-radius:50%;background:radial-gradient(circle,#282329 0 30%,transparent 31%),conic-gradient(from 0deg,#ed6b7410,#f4f0e408,#ed6b7410);}
  .wheel-circle:before {content:"";position:absolute;inset:20%;border:1px dashed #f4f0e451;border-radius:50%;}.wheel-center {position:absolute;inset:30%;display:grid;align-content:center;justify-items:center;text-align:center;gap:5px;}.wheel-center small {font:900 11px var(--font-mono,monospace);color:#ed6b74;}.wheel-center strong {font-size:18px;line-height:1.15;max-height:3.5em;overflow:hidden;}.wheel-center span {font-size:11px;opacity:.7;}
  .wheel-action {position:absolute;top:50%;left:50%;width:118px;min-height:62px;transform:translate(-50%,-50%) rotate(var(--wheel-angle)) translateY(-190px) rotate(calc(-1 * var(--wheel-angle)));display:grid;align-content:center;gap:2px;text-align:center;background:#212026;border:1px solid #f4f0e44c;border-radius:12px;color:#f5f0e7;cursor:pointer;}.wheel-action span {color:var(--hh-accent);font:800 11px var(--font-mono,monospace);}.wheel-action strong {font-size:13px;}.wheel-action.active,.wheel-action:focus-visible {background:var(--hh-accent);color:#16171a;outline:3px solid #f5f0e7;outline-offset:2px;}.wheel-action.active span {color:#16171a;}.wheel-action:disabled {opacity:.45;}
  .wheel-list {width:min(92vw,520px);display:grid;gap:8px;}.wheel-list button {display:flex;gap:12px;align-items:center;text-align:left;min-height:50px;border-radius:5px;}.wheel-list button strong {flex:1;}.wheel-list button.active,.wheel-list button:focus-visible {background:var(--hh-accent);color:#16171a;outline:2px solid #fff;}.wheel-backdrop p {position:absolute;bottom:15px;font-size:13px;color:#f5f0e7ad;}
  @media(max-height:680px) { .wheel-circle {width:350px;height:350px;min-width:350px;min-height:350px;}.wheel-action {transform:translate(-50%,-50%) rotate(var(--wheel-angle)) translateY(-150px) rotate(calc(-1 * var(--wheel-angle)));}.wheel-center span {display:none;} }
  @media(prefers-reduced-motion:reduce) { .wheel-backdrop {backdrop-filter:none;} }
</style>
