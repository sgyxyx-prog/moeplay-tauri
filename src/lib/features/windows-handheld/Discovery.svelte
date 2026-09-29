<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../../components/Icon.svelte";
  import VirtualList from "./VirtualList.svelte";
  import { discoverySearch } from "./search.svelte";
  import type { ContentKind } from "./types";
  let { query, kind, request, onselected, onsearch }: { query: string; kind: ContentKind | "all"; request: number; onselected?: (id: string) => void; onsearch?: () => void } = $props();
  const results = $derived(discoverySearch.results);
  const labels = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说" };
  $effect(() => {
    const next = { query, kind, request };
    untrack(() => { void discoverySearch.ensure(next.query, next.kind, next.request); });
  });
</script>

<section class="discovery" aria-label="发现搜索结果">
  {#if !query.trim()}
    <div class="empty"><span class="empty-mark"><Icon name="search" size={35} stroke={1.2} /></span><h2>找一部想看的作品</h2><p>搜索游戏、番剧、漫画或小说，直接从结果继续使用。</p>{#if onsearch}<button onclick={onsearch}>搜索作品 <Icon name="arrowRight" size={17} /></button>{/if}</div>
  {:else}
    <div class="status" aria-live="polite">{discoverySearch.pending.length ? `正在查询 ${discoverySearch.pending.map(k => labels[k]).join("、")}…` : `找到 ${results.length} 项`}</div>
    {#each discoverySearch.errors as error}<p role="status">{labels[error.kind]}{error.source ? ` · ${error.source}` : ""}：{error.message}</p>{/each}
    <VirtualList items={results} itemKey={(item) => item.id} estimateSize={84} focusId={discoverySearch.focusId} initialScrollOffset={discoverySearch.scrollOffset} onscroll={(offset) => discoverySearch.scroll(offset)} onselect={(item) => { discoverySearch.select(item.id); onselected?.(item.id); }}>
      {#snippet children(item)}
        <button class="result" data-focus-key={item.id} onclick={() => { discoverySearch.select(item.id); onselected?.(item.id); void item.open(); }}><span class="type">{labels[item.kind]}</span><span><strong>{item.title}</strong><small>{item.source}</small></span><span aria-hidden="true">→</span></button>
      {/snippet}
    </VirtualList>
    {#if results.length === 0 && discoverySearch.pending.length === 0}<div class="empty"><h2>没有找到作品</h2><p>可修改关键词，或在“我的 → 来源”检查可用来源。</p></div>{/if}
  {/if}
</section>

<style>
  .discovery { min-height: 0; height: 100%; display:flex;flex-direction:column;gap:12px; }
  .status,p,small { color:var(--hh-muted,#b6b3c8);font-size:var(--hh-aux,14px); }
  p { margin:0; max-height:80px;overflow:auto; }
  .result { display:flex;align-items:center;gap:16px;width:100%;min-height:76px;padding:12px 16px;text-align:left;border:1px solid #dfe1ed;border-radius:16px;background:#fff;color:#202535;cursor:pointer;font:inherit; }
  .result:hover {background:#f5f2ff;}.result:focus-visible { outline:3px solid #5748ad;outline-offset:2px; }
  .result>span:nth-child(2) {flex:1;min-width:0;} strong,small {display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .type {font-size:14px;color:#5748ad;font-weight:720;}
  .empty {margin:auto;text-align:center;max-width:600px;padding:24px;}
  .status,p,small {color:#b4bfd1;}
  .result {background:#1b2638;border-color:#ffffff24;color:#f4f2fa;border-radius:12px;}
  .result:hover {background:#2a3650;}.result:focus-visible {outline-color:#d8cafa;}
  .type {color:#d1bff9;}.empty {color:#f4f2fa;width:min(100%,720px);min-height:285px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:11px;border:1px solid #ffffff25;border-radius:18px;background:radial-gradient(circle at 50% 10%,#3d426151,transparent 58%),#1a2537;}
  .empty h2 {margin:0;font-size:clamp(22px,2vw,32px);}.empty p {margin:0;max-height:none;}.empty-mark {width:72px;height:72px;display:grid;place-items:center;border:1px solid #d3c4f258;border-radius:19px;background:#d3c4f21a;color:#e3d9f8;}
  .empty button {display:flex;align-items:center;gap:8px;min-height:46px;margin-top:7px;padding:8px 19px;border:0;border-radius:9px;background:#e4ddf7;color:#201c31;font:inherit;font-weight:700;cursor:pointer;}
  .empty button:focus-visible {outline:3px solid #d8cafa;outline-offset:3px;}
  @media(max-height:550px) {.empty {min-height:220px;padding:14px;gap:5px;}.empty-mark {width:46px;height:46px;border-radius:12px;}.empty h2 {font-size:20px;}}
</style>
