<script lang="ts">
  import Icon from "../../components/Icon.svelte";
  import VirtualList from "./VirtualList.svelte";
  import WorkFallback from "./WorkFallback.svelte";
  import { catalogStore } from "./catalog.svelte";
  import { displayProfile } from "./profile.svelte";
  import type { HandheldContentItem } from "./types";

  let { items, selected, recentOffset, onrecentScroll, onselect, onopen, onmore, onalbum, onlibrary, onsearch, onimport }:
    { items: HandheldContentItem[]; selected: HandheldContentItem | null; recentOffset: number;
      onrecentScroll: (offset: number) => void; onselect: (item: HandheldContentItem) => void;
      onopen: (item: HandheldContentItem) => void; onmore: () => void;
      onalbum: (id: string) => void; onlibrary: () => void; onsearch: () => void; onimport: () => void } = $props();
  const kinds = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说" };
  const kindIcon = { game: "gamepad", anime: "film", comic: "image", novel: "book" };
  const recent = $derived(items.slice(0, 24));
  const pinned = $derived(catalogStore.albums.filter(album => album.pinned).slice(0, 4));
  let failedImages = $state<string[]>([]);
  const coverSrc = $derived(selected?.cover?.src && !failedImages.includes(selected.cover.src) ? selected.cover.src : null);
  const backdropSrc = $derived(selected?.hero?.src && !failedImages.includes(selected.hero.src)
    ? selected.hero.src : coverSrc);
  const wideArt = $derived(Boolean(selected?.hero?.src && selected.hero.src !== selected.cover?.src && backdropSrc === selected.hero.src));
  function imageFailed(src: string) { if (!failedImages.includes(src)) failedImages = [...failedImages, src]; }
</script>

{#if selected}
  <div class="immersive-home">
    <section class="feature-stage" aria-label="继续当前作品">
      {#if backdropSrc}
        <img class:wide={wideArt} class="stage-art" src={backdropSrc} alt="" decoding="async"
          onerror={() => imageFailed(backdropSrc)} />
      {:else}
        <div class="stage-pattern" aria-hidden="true"><span>{kinds[selected.kind]}</span><strong>{Array.from(selected.title).slice(0, 2).join("")}</strong><i></i></div>
      {/if}
      <div class="stage-copy">
        <span class="type-pill"><Icon name={kindIcon[selected.kind]} size={17} />{kinds[selected.kind]} · 接着上次</span>
        <h1>{selected.title}</h1>
        <p class="progress-label">{selected.progressLabel}</p>
        {#if selected.progress !== null}<progress value={selected.progress} max="1" aria-label="内容进度"></progress>{/if}
        <div class="stage-actions">
          <button class="primary" disabled={!selected.actions.some(action => (action.id === "open" || action.id === "launch") && action.enabled)}
            onclick={() => onopen(selected)}><Icon name={selected.kind === "game" ? "gamepad" : "play"} size={20} />{selected.primaryLabel}</button>
          <button class="secondary" onclick={onmore}><Icon name="grid" size={18} />作品操作</button>
        </div>
      </div>
    </section>

    <section class="recent-section" aria-label="最近使用">
      <div class="section-heading"><div><h2>最近使用</h2><span>选一部作品，接着上次的位置</span></div><button onclick={onlibrary}>查看全部 <Icon name="arrowRight" size={16} /></button></div>
      <div class="recent-rail">
        <VirtualList items={recent} itemKey={item => item.id} orientation="horizontal" estimateSize={182}
          focusId={selected.id} initialScrollOffset={recentOffset} onscroll={onrecentScroll} label="最近使用作品" onselect={onselect}>
          {#snippet children(item)}
            <button class="recent-card" class:selected={selected.id === item.id}
              aria-label={item.title + "，" + item.progressLabel} onclick={() => onselect(item)} ondblclick={() => onopen(item)}>
              <span class="thumb">
                {#if item.cover?.src && !failedImages.includes(item.cover.src)}
                  <img src={item.cover.src} alt="" loading="lazy" decoding="async" onerror={() => imageFailed(item.cover!.src)} />
                {:else}<WorkFallback title={item.title} kind={item.kind} />{/if}
              </span>
              <span class="recent-title">{item.title}</span><small>{item.progressLabel}</small>
            </button>
          {/snippet}
        </VirtualList>
      </div>
    </section>
    {#if pinned.length}
      <section class="pinned-section" aria-label="置顶专题">
        <h2>置顶专题</h2><div>{#each pinned as album}
          <button onclick={() => onalbum(album.id)}><Icon name="collection" size={18} /><span>{album.title}</span><small>{album.members.length} 部作品</small></button>
        {/each}</div>
      </section>
    {/if}
  </div>
{:else}
  <div class="welcome"><span class="welcome-icon"><Icon name="collection" size={46} stroke={1.1} /></span>
    <h1>从喜欢的作品开始</h1><p>游玩、观看或阅读后，这里会记住你的进度。</p>
    <div><button class="primary" onclick={onlibrary}>打开藏馆</button><button onclick={onimport}>导入游戏</button><button onclick={onsearch}>搜索作品</button></div>
  </div>
{/if}

<style>
  .immersive-home {min-height:0;height:100%;overflow:auto;display:flex;flex-direction:column;gap:20px;scrollbar-width:thin;padding:2px 2px 18px;}
  .feature-stage {position:relative;isolation:isolate;flex:none;min-height:300px;height:clamp(300px,43vh,520px);overflow:hidden;border-radius:24px;
    background:radial-gradient(circle at 82% 20%,color-mix(in srgb,var(--hh-accent) 42%,#415875),transparent 48%),linear-gradient(120deg,#121b31,#273451 70%,#596380);
    box-shadow:0 18px 42px #22304a29;border:1px solid #4d5873;}
  .feature-stage::after {content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,#111a30 0%,#111a30ee 28%,#111a30ad 49%,transparent 79%);}
  .stage-art {position:absolute;right:3%;top:0;height:100%;width:52%;object-fit:contain;object-position:center right;filter:drop-shadow(0 18px 24px #34374726);}
  .stage-art.wide {right:0;width:100%;object-fit:cover;object-position:center;mask-image:linear-gradient(to right,transparent 20%,#000 72%);}
  .stage-pattern {position:absolute;right:5%;top:8%;bottom:8%;width:44%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;overflow:hidden;border:1px solid #ffffff3a;border-radius:28px;background:linear-gradient(145deg,#a8b2d126,#d5aab32d);color:#fff;transform:rotate(2deg);}
  .stage-pattern::before {content:"";position:absolute;width:65%;aspect-ratio:1;border:1px solid #ffffff55;border-radius:50%;box-shadow:0 0 0 22px #ffffff13,0 0 0 46px #ffffff0d;}
  .stage-pattern span {z-index:1;font-size:13px;font-weight:800;letter-spacing:.24em;}.stage-pattern strong {z-index:1;font-size:clamp(56px,8vw,150px);letter-spacing:-.14em;line-height:1;text-shadow:0 10px 25px #111a3066;}.stage-pattern i {z-index:1;width:18%;height:3px;background:#ffffffce;}
  .stage-copy {position:relative;z-index:1;width:min(54%,600px);height:100%;padding:clamp(22px,3vw,48px);box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:clamp(10px,2vh,20px);}
  .type-pill {display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:#ffffff25;color:#f6f4ff;border:1px solid #ffffff55;font-size:var(--hh-aux);font-weight:700;}
  h1,h2,p {margin:0;} h1 {max-width:100%;font-size:clamp(28px,3.3vw,54px);line-height:1.12;letter-spacing:-.04em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere;color:#fff;}
  .progress-label {font-weight:650;color:#e1e5f0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  progress {width:min(360px,100%);height:7px;accent-color:var(--hh-accent);border-radius:8px;}
  .stage-actions {display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;}
  button {font:inherit;cursor:pointer;min-height:var(--hh-target,48px);color:#202535;}
  .stage-actions button,.welcome button {display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:12px;padding:9px 18px;font-weight:750;}
  .primary {background:#eee9ff;border:1px solid transparent;color:#242046!important;box-shadow:0 6px 14px #080e1f40;}
  .primary:disabled {opacity:.48;box-shadow:none;cursor:default;}
  .secondary {background:#ffffff21;border:1px solid #ffffff69;color:#fff;}
  button:focus-visible {outline:3px solid #5746b9;outline-offset:3px;}
  .recent-section {flex:none;min-height:0;}
  .section-heading {display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:16px;}
  .section-heading>div {display:flex;align-items:baseline;gap:14px;min-width:0;}
  h2 {font-size:clamp(20px,1.7vw,30px);font-weight:760;letter-spacing:-.025em;color:#202535;}
  .section-heading span {color:#697186;font-size:var(--hh-aux);}
  .section-heading button {display:flex;align-items:center;gap:5px;min-height:44px;padding:0 6px;border:0;background:transparent;color:#51459b;font-weight:700;white-space:nowrap;}
  .recent-rail {height:184px;min-height:184px;}
  .recent-rail :global(.wh-virtual-list) {--wh-gap:12px;}
  .recent-card {display:flex;flex-direction:column;align-items:stretch;gap:3px;width:100%;height:100%;padding:5px;border:2px solid transparent;border-radius:16px;background:#fff;text-align:left;}
  .recent-card.selected {border-color:var(--hh-action,#6253b8);background:#ffffff;box-shadow:0 5px 14px #55478e26;}
  .thumb {height:112px;flex:none;display:grid;place-items:center;overflow:hidden;border-radius:11px;color:#8172c6;background:linear-gradient(140deg,#eae7fb,#f7f4fa 65%,#ebeef7);}
  .thumb img {width:100%;height:100%;object-fit:cover;}
  .recent-title,.recent-card small {display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-inline:4px;}
  .recent-title {font-size:var(--hh-aux);font-weight:750;} .recent-card small {font-size:12px;color:#687185;}
  .pinned-section {flex:none;padding-top:4px;} .pinned-section>div {display:flex;gap:10px;overflow:auto;margin-top:10px;}
  .pinned-section button {display:flex;align-items:center;gap:8px;white-space:nowrap;border:1px solid #cfd1e3;border-radius:14px;background:#ffffffb8;padding:8px 13px;}.pinned-section small {color:#697186;}
  .welcome {min-height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:16px;max-width:680px;margin:auto;}
  .welcome-icon {width:86px;height:86px;display:grid;place-items:center;border-radius:24px;background:#e8e4fa;color:#6957c3;}
  .welcome p {color:#697186;font-size:var(--hh-body);}.welcome>div {display:flex;gap:10px;flex-wrap:wrap;}.welcome button:not(.primary) {border:1px solid #cfd1e3;background:#fff;}
  @media(max-width:960px) {.feature-stage {height:clamp(260px,45vh,420px);} .stage-copy {width:66%;padding:20px;} .stage-art:not(.wide) {right:1%;width:45%;opacity:.65;} .section-heading span {display:none;}}
  @media(max-height:550px) {.feature-stage {min-height:246px;height:246px;} .stage-copy {gap:6px;padding:16px;width:72%;}.stage-copy h1 {font-size:26px;}.stage-art {opacity:.42;}.recent-rail {height:160px;min-height:160px;}.thumb {height:91px;}}
  @media(prefers-reduced-motion:reduce) {.feature-stage,.recent-card {transition:none;}}
</style>
