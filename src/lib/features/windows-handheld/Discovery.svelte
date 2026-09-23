<script lang="ts">
  import { untrack } from "svelte";
  import VirtualList from "./VirtualList.svelte";
  import { discoverySearch } from "./search.svelte";
  import type { ContentKind } from "./types";
  let { query, kind, request, onselected }: { query: string; kind: ContentKind | "all"; request: number; onselected?: (id: string) => void } = $props();
  const results = $derived(discoverySearch.results);
  const labels = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说" };
  $effect(() => {
    const next = { query, kind, request };
    untrack(() => { void discoverySearch.ensure(next.query, next.kind, next.request); });
  });
</script>

<section class="discovery" aria-label="发现搜索结果">
  {#if !query.trim()}
    <div class="empty"><h2>找一部想看的作品</h2><p>按搜索键或点击顶部搜索，用系统中文输入法输入名称。</p></div>
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
</style>
