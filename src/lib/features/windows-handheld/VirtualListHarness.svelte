<script lang="ts">
  import VirtualList from "./VirtualList.svelte";
  let { items, columns = 1, focusId = null, initialScrollOffset = 0 }: { items: string[]; columns?: number; focusId?: string | null; initialScrollOffset?: number } = $props();
  let list: VirtualList<string>;
  export function focusItem(id: string) { return list.focusItem(id); }
  export function cancelFocus() { list.cancelFocus(); }
</script>

<button data-testid="outside">其他操作</button>
<div style="height:480px;width:640px">
  <VirtualList bind:this={list} {items} itemKey={item => item} {columns} {focusId} {initialScrollOffset} estimateSize={60}>
    {#snippet children(item)}<button data-testid={`item-${item}`}>{item}</button>{/snippet}
  </VirtualList>
</div>
