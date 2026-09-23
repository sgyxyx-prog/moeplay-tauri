<script lang="ts" generics="T">
  import { onDestroy, onMount, tick, untrack, type Snippet } from "svelte";
  import { get } from "svelte/store";
  import { createVirtualizer, defaultRangeExtractor } from "@tanstack/svelte-virtual";
  import { routerStore } from "../../stores/router.svelte";
  import { adjacentItemIndex, createFocusTransactions, includePinnedRow, restoreFocusId, type FocusDirection } from "./focus";

  interface Props {
    items: readonly T[];
    itemKey: (item: T) => string;
    estimateSize?: number;
    columns?: number;
    children: Snippet<[T, number]>;
    focusId?: string | null;
    /** Consumed only when the list mounts; subsequent scrolls belong to the user. */
    initialScrollOffset?: number;
    onselect?: (item: T, index: number) => void;
    onscroll?: (offset: number) => void;
    overlayId?: string | null;
    label?: string;
    class?: string;
  }
  let { items, itemKey, estimateSize = 72, columns = 1, children, focusId = null, initialScrollOffset = 0,
    onselect, onscroll, overlayId = null, label = "内容列表", class: className = "" }: Props = $props();
  let root = $state<HTMLDivElement>();
  let pinnedId = $state<string | null>(null);
  let selectedId: string | null = null;
  let ownsFocus = false;
  let destroyed = false;
  let layoutVersion = 0;
  let previousKeys: string[] = [];
  const elements = new Map<string, HTMLElement>();
  const safeColumns = $derived(Math.max(1, Math.floor(columns) || 1));
  const rowHeight = $derived(Math.max(1, estimateSize || 72));
  const keys = $derived(items.map(itemKey));
  const indexes = $derived(new Map(keys.map((key, index) => [key, index])));
  const rowCount = $derived(Math.ceil(items.length / safeColumns));
  const listVersion = $derived(JSON.stringify(keys));
  const pinnedRow = $derived(pinnedId && indexes.has(pinnedId) ? Math.floor(indexes.get(pinnedId)! / safeColumns) : -1);
  const activeOverlay = () => routerStore.topOverlay?.id ?? null;
  const context = () => ({ listVersion, layoutVersion: `${layoutVersion}:${safeColumns}:${rowHeight}`, overlayId: activeOverlay() });
  const transactions = createFocusTransactions(context);
  const canFocus = () => !destroyed && Boolean(root?.isConnected) && activeOverlay() === overlayId;
  const mayRestore = () => ownsFocus && canFocus() && document.hasFocus() && (root?.contains(document.activeElement) || document.activeElement === document.body);

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => root ?? null,
    estimateSize: () => 72,
    overscan: 3,
    initialRect: { width: 640, height: 480 },
    initialOffset: () => Math.max(0, Number.isFinite(initialScrollOffset) ? initialScrollOffset : 0),
  });

  $effect(() => {
    const count = rowCount;
    const height = rowHeight;
    const columnCount = safeColumns;
    const rowKeys = keys;
    const pinned = pinnedRow;
    const scrollElement = root;
    untrack(() => get(virtualizer).setOptions({
      count,
      getScrollElement: () => scrollElement ?? null,
      estimateSize: () => height,
      getItemKey: (index) => rowKeys[index * columnCount] ?? index,
      rangeExtractor: (range) => includePinnedRow(defaultRangeExtractor(range), pinned, count),
    }));
  });

  export function cancelFocus() { transactions.cancel(); }

  function nextFocusId(direction: FocusDirection): string | null {
    if (!canFocus() || !root?.contains(document.activeElement)) return null;
    const active = document.activeElement?.closest<HTMLElement>("[data-virtual-item-id]")?.dataset.virtualItemId;
    const next = adjacentItemIndex(indexes.get(active ?? selectedId ?? "") ?? -1, items.length, safeColumns, direction);
    return next === null ? null : keys[next];
  }

  export async function moveFocus(direction: FocusDirection): Promise<boolean> {
    const id = nextFocusId(direction);
    return id ? focusItem(id) : false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable='true']")) return;
    const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowUp"];
    if (!direction) return;
    const id = nextFocusId(direction);
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    void focusItem(id);
  }

  export async function focusItem(id: string): Promise<boolean> {
    cancelFocus();
    const index = indexes.get(id);
    if (index === undefined || !canFocus()) return false;
    const ticket = transactions.begin(id);
    pinnedId = id;
    await tick();
    if (!transactions.isCurrent(ticket) || !canFocus()) return false;
    get(virtualizer).scrollToIndex(Math.floor(index / safeColumns), { align: "auto" });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await tick();
      if (!transactions.isCurrent(ticket) || !canFocus()) return false;
      const wrapper = elements.get(id);
      if (wrapper?.isConnected) {
        const target = wrapper.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? wrapper;
        target.focus({ preventScroll: true });
        return document.activeElement === target || wrapper.contains(document.activeElement);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return false;
  }

  function bindItem(node: HTMLElement, id: string) {
    elements.set(id, node);
    return { destroy() { if (elements.get(id) === node) elements.delete(id); } };
  }

  function handleFocus(event: FocusEvent) {
    if (!(event.target instanceof Element)) return;
    const wrapper = event.target.closest<HTMLElement>("[data-virtual-item-id]");
    const id = wrapper?.dataset.virtualItemId;
    if (!id || !root?.contains(wrapper)) return;
    selectedId = id;
    pinnedId = id;
    ownsFocus = true;
    const index = indexes.get(id);
    if (index !== undefined) onselect?.(items[index], index);
  }

  function handleBlur(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return;
    // A removed row has no relatedTarget. Preserve ownership for the next-ID fallback.
    if (event.relatedTarget) { ownsFocus = false; cancelFocus(); }
  }

  $effect(() => {
    const nextKeys = keys;
    untrack(() => {
      if (previousKeys.length && previousKeys.join("\0") !== nextKeys.join("\0")) {
        cancelFocus();
        const nextId = restoreFocusId(previousKeys, nextKeys, selectedId);
        const restore = ownsFocus;
        selectedId = nextId;
        pinnedId = nextId;
        if (restore && mayRestore()) {
          if (nextId) void focusItem(nextId);
          else root?.focus({ preventScroll: true });
        }
      }
      previousKeys = [...nextKeys];
    });
  });

  $effect(() => {
    safeColumns; rowHeight;
    untrack(() => {
      cancelFocus();
      get(virtualizer).measure();
      if (selectedId && mayRestore()) void focusItem(selectedId);
    });
  });

  $effect(() => {
    const requested = focusId;
    // A nested media drawer is registered by its parent action after this
    // child mounts. Track the router layer so a requested focus is retried
    // once this list actually owns the active overlay.
    const overlay = activeOverlay();
    if (requested && overlay === overlayId) untrack(() => { void focusItem(requested); });
  });

  let previousOverlay: string | null | undefined;
  $effect(() => {
    const nextOverlay = activeOverlay();
    untrack(() => { if (previousOverlay !== undefined && previousOverlay !== nextOverlay) cancelFocus(); previousOverlay = nextOverlay; });
  });

  onMount(() => {
    const observer = new ResizeObserver(() => {
      layoutVersion += 1;
      cancelFocus();
      if (selectedId && mayRestore()) void focusItem(selectedId);
    });
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: FocusDirection; handled: boolean }>).detail;
      if (!detail || detail.handled) return;
      const id = nextFocusId(detail.direction);
      if (!id) return;
      detail.handled = true;
      void focusItem(id);
    };
    root?.addEventListener("moeplay:virtual-navigate", navigate);
    if (root) observer.observe(root);
    if (focusId) void focusItem(focusId);
    return () => { observer.disconnect(); root?.removeEventListener("moeplay:virtual-navigate", navigate); };
  });
  onDestroy(() => { destroyed = true; cancelFocus(); elements.clear(); });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (delegates directional keys from interactive children) -->
<div bind:this={root} class="wh-virtual-list {className}" role="group" aria-label={label} tabindex="-1"
  data-testid="handheld-virtual-list" onfocusin={handleFocus} onfocusout={handleBlur}
  onkeydown={handleKeydown}
  onscroll={() => { if (root) onscroll?.(root.scrollTop); }}>
  <div class="wh-virtual-list__space" style:height={`${$virtualizer.getTotalSize()}px`}>
    {#each $virtualizer.getVirtualItems() as row (row.key)}
      <div class="wh-virtual-list__row" data-index={row.index} style:height={`${rowHeight}px`}
        style:transform={`translateY(${row.start}px)`} style:grid-template-columns={`repeat(${safeColumns}, minmax(0, 1fr))`}>
        {#each items.slice(row.index * safeColumns, (row.index + 1) * safeColumns) as item, offset (itemKey(item))}
          <div class="wh-virtual-list__item" use:bindItem={itemKey(item)} data-virtual-item-id={itemKey(item)} tabindex="-1">
            {@render children(item, row.index * safeColumns + offset)}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .wh-virtual-list { min-width: 0; min-height: 0; width: 100%; height: 100%; overflow: auto; overscroll-behavior: contain; overflow-anchor: none; }
  .wh-virtual-list__space { position: relative; width: 100%; }
  .wh-virtual-list__row { position: absolute; top: 0; left: 0; display: grid; width: 100%; gap: var(--wh-gap, 12px); }
  .wh-virtual-list__item { min-width: 0; min-height: 0; padding-bottom: var(--wh-gap, 12px); box-sizing: border-box; }
  .wh-virtual-list__item:focus-visible { outline: 2px solid var(--accent, #ee8095); outline-offset: -2px; }
</style>
