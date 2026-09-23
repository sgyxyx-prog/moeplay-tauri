<script lang="ts">
  import AdaptiveChromaStage from "../media-workspace/chroma/AdaptiveChromaStage.svelte";
  import VirtualList from "./VirtualList.svelte";
  import { catalogStore } from "./catalog.svelte";
  import { displayProfile } from "./profile.svelte";
  import type { HandheldContentItem } from "./types";

  let { items, selected, onselect, onopen, onmore, onalbum, onlibrary, onsearch }:
    { items: HandheldContentItem[]; selected: HandheldContentItem | null;
      onselect: (item: HandheldContentItem) => void; onopen: (item: HandheldContentItem) => void;
      onmore: () => void; onalbum: (id: string) => void; onlibrary: () => void; onsearch: () => void } = $props();
  const kinds = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说" };
  const recent = $derived(items.slice(0, 24));
  const pinned = $derived(catalogStore.albums.filter(album => album.pinned).slice(0, 4));
</script>

{#if selected}
  <div class="editorial-home">
    <div class="issue-line"><span>MOEPLAY / OPEN ISSUE</span><span>接着上次 · {items.length} 项进度</span></div>
    <div class="hero-frame"><AdaptiveChromaStage src={selected.hero?.src ?? selected.cover?.src} strength={displayProfile.profile.lightEffects ? "off" : "balanced"} class="editorial-stage">
      <div class="hero-wash"></div><div class="portrait">{#if selected.cover?.src}<img src={selected.cover.src} alt="" decoding="async" />{:else}<span>{kinds[selected.kind]}</span>{/if}</div>
      <div class="hero-copy"><span class="tag">{kinds[selected.kind]} / CONTINUE</span><h1>{selected.title}</h1><p class="chapter">{selected.progressLabel}</p>
        {#if selected.progress !== null}<progress value={selected.progress} max="1" aria-label="内容进度"></progress>{/if}
        <div class="hero-actions"><button class="hero-primary" disabled={!selected.actions.some(action => (action.id === "open" || action.id === "launch") && action.enabled)} onclick={() => onopen(selected)}>{selected.primaryLabel} <span aria-hidden="true">↗</span></button><button onclick={onmore}>操作与详情</button></div>
      </div><span class="hero-index">01</span>
    </AdaptiveChromaStage></div>
    <div class="shelf-heading"><span class="section-kicker">YOUR NEXT PAGES / 最近使用</span><span>方向键选择 · A 继续 · X 更多</span></div>
    <div class="recent-list"><VirtualList items={recent} itemKey={item => item.id} estimateSize={104} focusId={selected.id} label="最近使用作品" onselect={onselect}>
      {#snippet children(item, index)}<button class="recent-card" class:current={selected.id === item.id} onclick={() => onselect(item)} ondblclick={() => onopen(item)}><span class="recent-no">{String(index + 1).padStart(2, "0")}</span>{#if item.cover?.src}<img src={item.cover.src} alt="" loading="lazy" />{:else}<span class="missing-art">{kinds[item.kind]}</span>{/if}<span class="recent-copy"><small>{kinds[item.kind]}</small><strong>{item.title}</strong><em>{item.progressLabel}</em></span><span class="arrow">↗</span></button>{/snippet}
    </VirtualList></div>
    {#if pinned.length}<div class="pinned"><span class="section-kicker">PINNED ISSUES / 置顶专题</span>{#each pinned as album}<button onclick={() => onalbum(album.id)}>{album.title}<small>{album.members.length} 部作品</small></button>{/each}</div>{/if}
  </div>
{:else}
  <div class="welcome"><span class="section-kicker">MOEPLAY / VOL. 01</span><h1>从喜欢的作品开始</h1><p>在藏馆里挑一部游戏、番剧、漫画或小说。下次打开，会从这里接着使用。</p><div><button onclick={onlibrary}>打开藏馆</button><button onclick={onsearch}>搜索作品</button></div></div>
{/if}

<style>
  .editorial-home { min-height:0;height:100%;display:flex;flex-direction:column;gap:9px;overflow:hidden; }
  .issue-line,.shelf-heading {display:flex;justify-content:space-between;gap:12px;align-items:center;color:#f2eee1b8;font:700 11px/1.2 var(--font-mono,monospace);letter-spacing:.1em;}
  .issue-line {border-bottom:2px solid var(--hh-accent);padding:4px 0 8px;} .hero-frame {flex:1;min-height:215px;overflow:hidden;}
  :global(.editorial-stage) {width:100%;height:100%;position:relative;overflow:hidden;display:flex;align-items:center;gap:clamp(12px,3vw,42px);padding:clamp(12px,2vw,30px);box-sizing:border-box;}
  .hero-wash {position:absolute;inset:0;background:linear-gradient(90deg,#111319eb 0%,#111319bd 65%,#111319b1 100%);pointer-events:none;}
  .portrait,.hero-copy,.hero-index {position:relative;z-index:1;} .portrait {height:100%;width:min(31%,220px);flex:none;background:#f2eee31a;box-shadow:12px 12px 0 #e9657055;overflow:hidden;display:grid;place-items:center;} .portrait img {width:100%;height:100%;object-fit:cover;} .portrait span {color:#f2eee1;font-weight:800;}
  .hero-copy {min-width:0;max-width:65%;display:flex;flex-direction:column;align-items:start;gap:8px;} .tag,.section-kicker {font:750 11px/1.2 var(--font-mono,monospace);letter-spacing:.13em;color:rgb(var(--media-accent-rgb,233,101,112));}
  h1,p {margin:0;} .hero-copy h1 {max-width:100%;font-size:clamp(25px,3.7vw,58px);line-height:1.06;letter-spacing:-.045em;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;word-break:break-word;}
  .chapter {color:#f3eee1;font-weight:650;} progress {width:min(360px,100%);height:5px;accent-color:rgb(var(--media-accent-rgb,233,101,112));}
  .hero-actions {display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;} .hero-actions button {min-height:var(--hh-target,48px);padding:7px 18px;border:1px solid #fff8;background:#15161bb0;color:#f2eee1;font:inherit;font-weight:700;cursor:pointer;} .hero-actions .hero-primary {background:rgb(var(--media-accent-rgb,233,101,112));color:rgb(var(--media-on-accent-rgb,20,20,20));border:0;} .hero-primary span {margin-left:12px;} .hero-index {margin-left:auto;align-self:start;font:900 64px/.8 var(--font-mono,monospace);opacity:.23;}
  .shelf-heading {border-bottom:1px solid #f2eee146;padding:2px 0 5px;} .recent-list {height:clamp(120px,22vh,230px);min-height:120px;} .recent-card {display:flex;width:100%;height:100%;align-items:center;text-align:left;gap:12px;border:0;border-bottom:1px solid #f2eee125;border-radius:0;background:#f2eee108;padding:8px;color:#f2eee1;cursor:pointer;} .recent-card.current {background:#f2eee11c;box-shadow:inset 4px 0 #e96570;}
  .recent-no {font:800 20px var(--font-mono,monospace);color:#e96570;align-self:start;} .recent-card img,.missing-art {height:80px;width:62px;flex:none;object-fit:cover;background:#36333a;display:grid;place-items:center;font-size:12px;} .recent-copy {min-width:0;display:grid;gap:2px;flex:1;} .recent-copy strong,.recent-copy em {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .recent-copy small {color:#e96570;font-size:12px;} .recent-copy em {font-size:13px;font-style:normal;opacity:.75;} .arrow {font-size:22px;color:#e96570;}
  .pinned {display:flex;align-items:center;gap:8px;min-height:42px;overflow-x:auto;}.pinned button {display:flex;gap:10px;align-items:center;white-space:nowrap;min-height:38px;border:1px solid #e9657066;border-radius:0;background:#e965701a;padding:5px 12px;color:#f2eee1;cursor:pointer;}.pinned small {opacity:.7;}
  .welcome {display:flex;flex-direction:column;justify-content:center;align-items:start;height:100%;max-width:650px;gap:20px;} .welcome h1 {font-size:clamp(38px,5vw,72px);line-height:1.05;}.welcome p {font-size:18px;}.welcome div {display:flex;gap:10px;}.welcome button {border-radius:0;background:#e96570;color:#111;}
  @media(max-width:960px) { .hero-frame {max-height:none;} .hero-index {display:none;} .portrait {width:28%;box-shadow:6px 6px 0 #e9657055;} .hero-copy {max-width:70%;} .shelf-heading>span:last-child {display:none;} }
  @media(max-height:550px) { .issue-line,.pinned {display:none;} .hero-frame {min-height:145px;max-height:48%;}.hero-copy h1 {font-size:25px;}.portrait {width:19%;}.recent-list {min-height:84px;height:100px;}.recent-card img,.missing-art {height:64px;width:48px;} }
  @media(prefers-reduced-motion:reduce) { :global(.editorial-stage) {transition:none!important;} }
</style>
