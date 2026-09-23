<script lang="ts">
  import Icon from "../../components/Icon.svelte";
  import { displayProfile } from "./profile.svelte";
  export interface WheelEntry { id: string; label: string; enabled: boolean; pending?: boolean; icon?: string; description?: string; run: () => void | Promise<void> }
  let { title, cover, entries, activeIndex, onselect, onrun, onclose, compact = false, ref = $bindable() }:
    { title: string; cover?: string; entries: WheelEntry[]; activeIndex: number; onselect: (index: number) => void;
      onrun: (entry: WheelEntry) => void; onclose: () => void; compact?: boolean; ref?: HTMLElement } = $props();
  const fallbackIcons: Record<string, string> = { resume: "play", details: "book", album: "collection", related: "layers", search: "search", favorite: "heart" };
  let coverFailed = $state(false);
  $effect(() => { cover; coverFailed = false; });
</script>

<div class="wheel-backdrop" class:light={displayProfile.profile.lightEffects} bind:this={ref} role="dialog" aria-modal="true" aria-label={title + " 的快捷操作"} tabindex="-1"
  onkeydown={event => { if (event.key === "Escape") { event.preventDefault(); onclose(); } }}>
  <div class="wheel-panel">
    <div class="wheel-head"><span>作品操作</span><button onclick={onclose} aria-label="关闭操作轮盘"><Icon name="x" size={20} /></button></div>
    {#if compact}
      <div class="wheel-list">{#each entries as entry, index (entry.id)}
        <button class:active={activeIndex === index} disabled={!entry.enabled || entry.pending} onclick={() => onrun(entry)} onfocus={() => onselect(index)}>
          <Icon name={entry.icon ?? fallbackIcons[entry.id] ?? "grid"} size={22} /><strong>{entry.pending ? "执行中…" : entry.label}</strong><Icon name="arrowRight" size={18} />
        </button>
      {/each}</div>
    {:else}
      <div class="wheel-circle"><div class="wheel-center">
        <span class="center-art">{#if cover && !coverFailed}<img src={cover} alt="" onerror={() => coverFailed = true} />{:else}<Icon name="collection" size={52} stroke={1} />{/if}</span>
        <strong>{title}</strong>
      </div>
      {#each entries as entry, index (entry.id)}
        <button class="wheel-action" class:active={activeIndex === index} style={"--wheel-angle:" + (index * 360 / entries.length - 90) + "deg"} disabled={!entry.enabled || entry.pending}
          onclick={() => onrun(entry)} onfocus={() => onselect(index)} onpointerenter={() => onselect(index)}>
          <Icon name={entry.icon ?? fallbackIcons[entry.id] ?? "grid"} size={23} /><strong>{entry.pending ? "执行中…" : entry.label}</strong>
        </button>
      {/each}</div>
    {/if}
    <p>方向键选择 · A 确认 · B 返回</p>
  </div>
</div>

<style>
  .wheel-backdrop {position:absolute;inset:0;z-index:500;display:grid;place-items:center;background:#eceef5b5;backdrop-filter:blur(16px);color:#202535;}
  .wheel-backdrop.light {background:#eceef5ed;backdrop-filter:none;}
  .wheel-panel {position:relative;width:min(94vw,720px);height:min(91vh,660px);display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;border:1px solid #d7daec;border-radius:28px;background:#fbfaffed;box-shadow:0 24px 70px #26305838;}
  .wheel-head {position:absolute;top:16px;left:20px;right:20px;z-index:2;display:flex;align-items:center;justify-content:space-between;font-weight:760;font-size:18px;}
  .wheel-head button {width:44px;height:44px;display:grid;place-items:center;border:1px solid #d6d9e8;border-radius:12px;background:white;color:#263047;cursor:pointer;}
  .wheel-circle {position:relative;width:min(62vh,470px);height:min(62vh,470px);max-width:68vw;max-height:68vw;border-radius:50%;
    border:1px solid #d5d5e8;background:radial-gradient(circle,#f9f8fe 0 28%,#eceafa 68%,#f6f7fc 100%);}
  .wheel-circle:before {content:"";position:absolute;inset:24%;border-radius:50%;border:1px solid #bdb8e0;}
  .wheel-center {position:absolute;inset:31%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;text-align:center;min-width:0;}
  .center-art {width:76px;height:76px;display:grid;place-items:center;overflow:hidden;border-radius:17px;background:#e5e2f6;color:#7262ba;}
  .center-art img {width:100%;height:100%;object-fit:contain;}
  .wheel-center strong {max-width:155px;max-height:2.6em;overflow:hidden;font-size:15px;line-height:1.25;overflow-wrap:anywhere;}
  .wheel-action {position:absolute;top:50%;left:50%;width:128px;min-height:72px;transform:translate(-50%,-50%) rotate(var(--wheel-angle)) translateY(-182px) rotate(calc(-1 * var(--wheel-angle)));
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;border:1px solid #d9dbe9;border-radius:15px;background:#ffffffed;color:#283046;box-shadow:0 5px 15px #3e46651b;cursor:pointer;}
  .wheel-action strong {font-size:14px;line-height:1.2;text-align:center;}
  .wheel-action.active,.wheel-action:focus-visible,.wheel-list button.active,.wheel-list button:focus-visible {outline:3px solid #5746b8;outline-offset:3px;border-color:#8b7eda;background:#ece9fd;color:#42368d;}
  .wheel-action:disabled,.wheel-list button:disabled {opacity:.48;cursor:default;}
  .wheel-list {width:min(88%,460px);display:grid;gap:9px;overflow:auto;max-height:calc(100% - 125px);}
  .wheel-list button {display:flex;align-items:center;gap:12px;min-height:50px;width:100%;padding:8px 15px;border:1px solid #d9dbe9;border-radius:13px;background:#fff;color:#283046;text-align:left;cursor:pointer;}
  .wheel-list button strong {flex:1;}.wheel-panel p {position:absolute;bottom:12px;margin:0;font-size:13px;color:#667084;}
  @media(max-height:780px) {.wheel-circle {width:390px;height:390px;}.wheel-action {transform:translate(-50%,-50%) rotate(var(--wheel-angle)) translateY(-152px) rotate(calc(-1 * var(--wheel-angle)));}}
  @media(prefers-reduced-motion:reduce) {.wheel-backdrop {backdrop-filter:none;}.wheel-action {transition:none;}}
</style>
