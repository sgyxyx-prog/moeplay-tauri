<script lang="ts">
  import { onMount, tick, type Snippet } from "svelte";
  import { uiStore } from "../../stores/ui.svelte";
  import { gameStore } from "../../stores/games.svelte";
  import { closeOverlay, closeTopOverlay, navigateTo, openOverlay, routerStore } from "../../stores/router.svelte";
  import { getViewLabel } from "../../nav";
  import { attachGamepad } from "../../components/switch/useGamepad.svelte";
  import { moveGamepadFocus, activateGamepadFocus } from "../../actions/a11y/domGamepadNavigation";
  import { adjustFocusedGamepadControl } from "../../actions/a11y/gamepadSemantics";
  import { gamepadGlyphFor, type GamepadAction } from "../../platform/gamepadRemap";
  import { resolveConnectedPadLayouts, type GamepadLayout } from "../../platform/gamepadLayout";
  import { Drawer } from "../../components/ui-v2";
  import { displayProfile, displayMetrics, keyboardInset } from "./profile.svelte";
  import { observeHandheldLayout, observeSessionSuspension } from "./layout";
  import { handheldSession, type HandheldTab } from "./session.svelte";
  import { handheldContentStore } from "./content.svelte";
  import type { ContentKind, HandheldContentItem } from "./types";
  import { showSystemKeyboard, hideSystemKeyboard, getSystemKeyboardState, onSystemKeyboardState, openKeyboardSettings, type WindowsKeyboardState } from "./native";
  import VirtualList from "./VirtualList.svelte";
  import Discovery from "./Discovery.svelte";
  import { discoverySearch } from "./search.svelte";
  import { catalogStore, memberOf } from "./catalog.svelte";
  import EditorialContinue from "./EditorialContinue.svelte";
  import AlbumView from "./AlbumView.svelte";
  import ActionWheel from "./ActionWheel.svelte";
  import { rankPaletteEntries } from "../palette/matcher";
  import { loadAdaptiveChromaPalette } from "../media-workspace/chroma/imagePalette";
  import Icon from "../../components/Icon.svelte";

  let { children, taskActiveCount = 0, taskFailedCount = 0 }: { children: Snippet; taskActiveCount?: number; taskFailedCount?: number } = $props();
  const tabs: { id: HandheldTab; label: string }[] = [{ id: "continue", label: "继续" }, { id: "library", label: "藏馆" }, { id: "discover", label: "发现" }, { id: "mine", label: "我的" }];
  const kinds: { id: ContentKind | "all"; label: string }[] = [{ id: "all", label: "全部" }, { id: "game", label: "游戏" }, { id: "anime", label: "番剧" }, { id: "comic", label: "漫画" }, { id: "novel", label: "小说" }];
  const labels = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说" };
  let root: HTMLElement;
  let list = $state<VirtualList<HandheldContentItem>>();
  let panelRoot = $state<HTMLElement>();
  let wheelRoot = $state<HTMLElement>();
  let wheelIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();
  let lastTextInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let size = $state({ width: 1280, height: 800 });
  let panel = $state<"content" | "quick" | "search" | "wheel" | "album-picker" | null>(null);
  let panelItem = $state<HandheldContentItem | null>(null);
  let albumFocusedItem = $state<HandheldContentItem | null>(null);
  let accentColor = $state("#7362cb");
  let failedImages = $state<string[]>([]);
  let searchText = $state("");
  let searchKind = $state<ContentKind | "all">("anime");
  let composing = $state(false);
  let searchRequest = $state(discoverySearch.request);
  let keyboardMessage = $state("");
  let keyboardState = $state<WindowsKeyboardState | null>(null);
  let layout = $state<GamepadLayout>("xbox");
  const tab = $derived(handheldSession.tab);
  const snapshot = $derived(handheldSession.current);
  const browse = $derived(uiStore.currentView === "home");
  const metrics = $derived(displayMetrics(size.width, displayProfile.profile.comfort));
  const cardWidth = $derived(Math.max(156, (displayProfile.profile.density === "compact" ? 150 : 180) * Math.max(.7, size.width / 1280) * displayProfile.profile.comfort / 100));
  const galleryColumns = $derived(Math.max(2, Math.floor((size.width - 4 * metrics.gap + 12) / (cardWidth + 12))));
  const galleryRowHeight = $derived(Math.round(cardWidth * 1.07 + 70));
  const inset = $derived(keyboardState?.visible ? keyboardInset(size, keyboardState.occluded, keyboardState.clientWidth) : 0);
  const rows = $derived.by(() => {
    let items = tab === "continue" ? handheldContentStore.continueItems : handheldContentStore.library;
    if (snapshot.kind !== "all") items = items.filter(item => item.kind === snapshot.kind);
    if (snapshot.filter === "favorites") items = items.filter(item => item.favorite);
    if (snapshot.filter === "local") items = items.filter(item => item.installed);
    if (snapshot.query) items = items.filter(item => item.title.toLocaleLowerCase().includes(snapshot.query.toLocaleLowerCase()));
    return [...items].sort(snapshot.sort === "title" ? (a, b) => a.title.localeCompare(b.title, "zh-CN") : (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  });
  const selected = $derived(rows.find(item => item.id === snapshot.selectedId) ?? rows[0] ?? null);
  const featured = $derived(panelItem ? handheldContentStore.library.find(item => item.id === panelItem?.id) ?? panelItem : tab === "library" && snapshot.libraryView === "albums" ? albumFocusedItem : selected);
  const accentSource = $derived(tab === "library" && snapshot.libraryView === "albums" && snapshot.albumId
    ? catalogStore.albums.find(album => album.id === snapshot.albumId)?.cover
    : featured?.hero?.src ?? featured?.cover?.src);
  $effect(() => {
    const source = accentSource;
    let current = true;
    accentColor = "#7362cb";
    if (source) void loadAdaptiveChromaPalette(source).then(palette => {
      if (current && palette.source === "media") accentColor = `rgb(${palette.accent.r},${palette.accent.g},${palette.accent.b})`;
    }).catch(() => {});
    return () => { current = false; };
  });
  const primary = $derived(featured?.actions.find(action => action.id === "launch" || action.id === "open"));
  const currentAction = $derived(browse && (tab === "continue" || tab === "library") && featured ? featured.primaryLabel : "确认");
  function imageFailed(src: string) { if (!failedImages.includes(src)) failedImages = [...failedImages, src]; }
  const localSearch = $derived.by(() => searchText.trim() ? rankPaletteEntries(searchText, [
    ...handheldContentStore.library.map(item => ({ id: item.id, label: item.title, hint: `${labels[item.kind]} · ${item.progressLabel}`, item, albumId: null as string | null })),
    ...catalogStore.albums.map(album => ({ id: `album:${album.id}`, label: album.title, hint: `专题 · ${album.members.length} 部作品`, item: null as HandheldContentItem | null, albumId: album.id })),
  ]).slice(0, 8) : []);
  const panelId = (p: string) => `windows-handheld-${p}`;
  const glyph = (action: GamepadAction) => gamepadGlyphFor(action, layout);
  function select(item: HandheldContentItem) { handheldSession.patch({ selectedId: item.id, focusKey: item.id }); }
  function openAlbum(id: string) { switchTab("library"); albumFocusedItem = null; handheldSession.patch({ libraryView: "albums", albumId: id }); }
  async function addToAlbum(albumId: string) {
    if (!featured) return;
    try { await catalogStore.addMember(albumId, memberOf(featured)); dismissPanel(); }
    catch (error) { uiStore.notify(String(error), "error"); }
  }
  function searchFor(title: string, kind: ContentKind | "book") {
    showPanel("search"); searchText = title; searchKind = kind === "book" ? "all" : kind;
  }
  const wheelEntries = $derived.by(() => {
    if (!featured) return [];
    const item = featured;
    const entries = [
      { id: "resume", label: item.primaryLabel, enabled: Boolean(primary?.enabled), pending: Boolean(primary?.pending), run: () => void handheldContentStore.activate(item) },
      { id: "details", label: "章节与详情", enabled: true, run: () => void handheldContentStore.openDetails(item) },
      { id: "album", label: "加入专题", enabled: true, run: () => showPanel("album-picker") },
      { id: "related", label: "查看关联", enabled: true, run: () => {
        const album = catalogStore.albums.find(entry => entry.members.some(member => member.contentId === item.id));
        if (album) openAlbum(album.id); else showPanel("album-picker");
      } },
      { id: "search", label: "查找来源", enabled: true, run: () => searchFor(item.title, item.kind) },
    ];
    const favorite = item.actions.find(action => action.id === "toggle-favorite");
    if (favorite) entries.push({ id: "favorite", label: favorite.label, enabled: favorite.enabled, pending: false, run: () => void favorite.run() });
    return entries.slice(0, 6);
  });
  function runWheel(entry: { run: () => void | Promise<void> }) {
    dismissPanel();
    void entry.run();
  }
  function openSearchResult(result: { item: HandheldContentItem | null; albumId: string | null }) {
    dismissPanel();
    if (result.albumId) openAlbum(result.albumId);
    else if (result.item) { select(result.item); void handheldContentStore.activate(result.item); }
  }
  function switchTab(next: HandheldTab) {
    if (panel) dismissPanel();
    handheldSession.select(next);
    if (!browse) navigateTo("home", { focus: "none" });
    void tick().then(() => { if (handheldSession.current.selectedId) void list?.focusItem(handheldSession.current.selectedId); });
  }
  function cycleTab(delta: number) { const index = tabs.findIndex(t => t.id === tab); switchTab(tabs[(index + delta + tabs.length) % tabs.length].id); }
  function cycleKind(delta: number) { const index = kinds.findIndex(k => k.id === snapshot.kind); handheldSession.patch({ kind: kinds[(index + delta + kinds.length) % kinds.length].id, scrollOffset: 0 }); }
  function back() {
    if (routerStore.topOverlay) { closeTopOverlay(); return; }
    if (!browse) { navigateTo("home", { focus: "none" }); void restoreSelection(); }
    else if (tab === "library" && snapshot.libraryView === "albums" && snapshot.albumId) handheldSession.patch({ albumId: null, albumMemberId: null });
  }
  async function restoreSelection() { await tick(); if (snapshot.selectedId) await list?.focusItem(snapshot.selectedId); }
  function dismissPanel() {
    if (!panel) return;
    const old = panel;
    panel = null;
    panelItem = null;
    closeOverlay(panelId(old));
    if (old === "search") void hideSystemKeyboard();
    void restoreSelection();
  }
  function showPanel(next: "content" | "quick" | "search" | "wheel" | "album-picker") {
    if (panel) dismissPanel();
    list?.cancelFocus();
    panelItem = next === "content" || next === "wheel" || next === "album-picker" ? tab === "library" && snapshot.libraryView === "albums" ? albumFocusedItem : selected : null;
    if (next === "search") { searchText = tab === "discover" ? snapshot.query : ""; searchKind = snapshot.kind === "all" ? selected?.kind ?? "anime" : snapshot.kind; }
    panel = next;
    if (next === "wheel") wheelIndex = 0;
    openOverlay({ id: panelId(next), kind: next === "search" ? "search" : "drawer", returnFocusKey: snapshot.selectedId }, dismissPanel);
  }
  async function keyboard() {
    const input = panel === "search" ? searchInput : lastTextInput?.isConnected ? lastTextInput : null;
    if (!input) { showPanel("search"); await tick(); searchInput?.focus({ preventScroll: true }); }
    else input.focus({ preventScroll: true });
    const result = await showSystemKeyboard();
    keyboardMessage = result.status === "requested" ? "已请求系统键盘；请在输入框中输入。" : result.reason || "系统键盘暂不可用，可打开 Windows 键盘设置。";
  }
  function submitSearch() {
    if (composing || !searchText.trim()) return;
    const text = searchText.trim();
    const kind = searchKind;
    dismissPanel();
    switchTab("discover");
    handheldSession.patch({ query: text, kind });
    searchRequest++;
  }
  async function runPrimary() {
    if (!featured || !primary?.enabled) return;
    const action = primary;
    if (panel) dismissPanel();
    await action.run();
  }
  function move(direction: "up" | "down" | "left" | "right") {
    if (panel === "wheel") { if (wheelEntries.length) wheelIndex = (wheelIndex + (direction === "right" || direction === "down" ? 1 : -1) + wheelEntries.length) % wheelEntries.length; return; }
    if (adjustFocusedGamepadControl(direction)) return;
    const scope = panelRoot && panel ? panelRoot : root;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const virtualRequest = { direction, handled: false };
    active?.dispatchEvent(new CustomEvent("moeplay:virtual-navigate", { bubbles: true, detail: virtualRequest }));
    if (virtualRequest.handled) return;
    if (!panel && browse && tab === "library" && snapshot.libraryView === "all" && active?.closest("[data-virtual-item-id]") && (direction === "down" || direction === "up")) {
      const index = rows.findIndex(item => item.id === snapshot.selectedId);
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (direction === "down" ? 1 : -1)))];
      if (next) { select(next); void list?.focusItem(next.id); }
      return;
    }
    moveGamepadFocus(direction, { root: scope });
  }
  function activate() {
    if (panel === "wheel") { const entry = wheelEntries[wheelIndex]; if (entry?.enabled && !entry.pending) runWheel(entry); return; }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!panel && browse && active?.closest("[data-virtual-item-id]") && (tab === "continue" || tab === "library" && snapshot.libraryView === "all")) { void runPrimary(); return; }
    activateGamepadFocus({ root: panel && panelRoot ? panelRoot : root });
  }
  let shellScope: ReturnType<typeof attachGamepad> | undefined;
  let panelScope: ReturnType<typeof attachGamepad> | undefined;
  $effect(() => { shellScope?.setEnabled(true); panelScope?.setEnabled(panel !== null && routerStore.topOverlay?.id === panelId(panel)); });
  onMount(() => {
    const releaseLayout = observeHandheldLayout(root, value => { size = value; });
    const releaseSession = observeSessionSuspension();
    const releaseContent = handheldContentStore.start();
    void catalogStore.load().catch(error => uiStore.notify(`专题读取失败：${String(error)}`, "error"));
    const rememberInput = (event: FocusEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) lastTextInput = event.target; };
    root.addEventListener("focusin", rememberInput);
    const refreshLayout = () => { layout = resolveConnectedPadLayouts(navigator.getGamepads?.() ?? [])[0]?.layout ?? "xbox"; };
    refreshLayout();
    window.addEventListener("gamepadconnected", refreshLayout);
    window.addEventListener("gamepaddisconnected", refreshLayout);
    let disposed = false;
    let releaseKeyboard = () => {};
    void onSystemKeyboardState(value => { keyboardState = value; }).then(async release => { if (disposed) { release(); return; } releaseKeyboard = release; const state = await getSystemKeyboardState(); if (!disposed) keyboardState = state; }).catch(() => {});
    const directions = { up: () => move("up"), down: () => move("down"), left: () => move("left"), right: () => move("right") };
    shellScope = attachGamepad({ ...directions, launch: activate, back, favorite: () => { if (browse && (tab === "continue" || tab === "library") && featured) showPanel("wheel"); }, activate: () => showPanel("search"), pageLeft: () => cycleTab(-1), pageRight: () => cycleTab(1), categoryLeft: () => cycleKind(-1), categoryRight: () => cycleKind(1), start: () => showPanel("quick") }, { id: "windows-handheld-shell", priority: 40, enabled: true });
    panelScope = attachGamepad({ ...directions, launch: activate, back, start: back }, { id: "windows-handheld-panel", priority: 200, overlay: true, enabled: false });
    return () => {
      disposed = true; releaseLayout(); releaseSession(); releaseContent(); releaseKeyboard(); shellScope?.(); panelScope?.();
      root.removeEventListener("focusin", rememberInput);
      window.removeEventListener("gamepadconnected", refreshLayout); window.removeEventListener("gamepaddisconnected", refreshLayout);
      if (panel) closeOverlay(panelId(panel));
    };
  });
</script>

<div bind:this={root} class="handheld-shell" class:compact={metrics.compact} class:light={displayProfile.profile.lightEffects} data-testid="windows-handheld-shell" style={`--hh-body:${metrics.body}px;--hh-aux:${metrics.auxiliary}px;--hh-target:${metrics.target}px;--hh-gap:${metrics.gap}px;--hh-keyboard:${inset}px;--hh-accent:${accentColor}`}>
  <header class="header">
    <span class="brand">Moe<span>Play</span></span>
    <nav aria-label="掌机主栏目">{#each tabs as item}<button class:active={tab === item.id && browse} aria-current={tab === item.id && browse ? "page" : undefined} onclick={() => switchTab(item.id)}>{item.label}</button>{/each}</nav>
    <button class="icon-button" aria-label="搜索内容" onclick={() => showPanel("search")}><Icon name="search" size={21} /></button>
    <button class="icon-button" aria-label="快捷面板" onclick={() => showPanel("quick")}><Icon name="settings" size={21} /></button>
  </header>
  <main class="body" class:inner={!browse}>
    {#if !browse}
      <div class="inner-heading"><button onclick={back}>← 返回{tabs.find(t => t.id === tab)?.label}</button><span>{getViewLabel(uiStore.currentView)}</span><button onpointerdown={e => e.preventDefault()} onclick={keyboard}>打开键盘</button></div>
      <div class="route-content">{@render children()}</div>
    {:else if tab === "mine"}
      <div class="section-heading"><div><h1>我的</h1></div><span>内容与偏好都留在这里</span></div>
      <div class="tools">
        <button onclick={() => { switchTab("library"); handheldSession.patch({ filter: "all", kind: "all" }); }}>完整历史与内容库 <small>按最近使用排序</small></button>
        <button onclick={() => { switchTab("library"); handheldSession.patch({ filter: "favorites", kind: "all" }); }}>收藏 <small>已收藏的游戏与媒体</small></button>
        <button onclick={() => void gameStore.importGame()}>导入本地游戏 <small>选择本机可执行文件</small></button>
        {#each [{view:"steam-import",label:"平台导入",sub:"Steam 游戏库"},{view:"tasks",label:"任务",sub:`${taskActiveCount} 项进行中 · ${taskFailedCount} 项失败`},{view:"sources",label:"来源",sub:"搜索、解析与可用状态"},{view:"downloads",label:"离线与下载",sub:"本机下载任务"},{view:"backup",label:"游戏存档备份",sub:"现有存档备份与恢复"},{view:"settings",label:"设置与同步",sub:"WebDAV、显示与手柄"}] as tool}<button onclick={() => navigateTo(tool.view)}>{tool.label}<small>{tool.sub}</small></button>{/each}
      </div>
    {:else if tab === "continue"}
      <EditorialContinue items={rows} {selected} recentOffset={snapshot.recentScrollOffset} onrecentScroll={offset => handheldSession.patch({ recentScrollOffset: offset })} onselect={select} onopen={item => void handheldContentStore.activate(item)} onmore={() => showPanel("wheel")} onalbum={openAlbum} onlibrary={() => switchTab("library")} onsearch={() => showPanel("search")} onimport={() => void gameStore.importGame()} />
    {:else if tab === "library" && snapshot.libraryView === "albums"}
      <div class="library-switch"><button onclick={() => handheldSession.patch({ libraryView: "all" })}>全部作品</button><button class="active">我的专题</button></div>
      <AlbumView items={handheldContentStore.library} activeAlbumId={snapshot.albumId} activeMemberId={snapshot.albumMemberId} onalbum={id => { albumFocusedItem = null; handheldSession.patch({ albumId: id, albumMemberId: null }); }} onmember={id => handheldSession.patch({ albumMemberId: id })} onselect={item => { albumFocusedItem = item; if (item) select(item); }} onopen={item => void handheldContentStore.activate(item)} onsearch={searchFor} />
    {:else}
      <div class="section-heading"><div><h1>{tab === "library" ? "全部作品" : "发现"}</h1></div><span>{tab === "discover" ? snapshot.query || "按名称搜索作品" : `${rows.length} 项内容`}</span></div>
      {#if tab === "library"}<div class="library-switch"><button class="active">全部作品</button><button onclick={() => handheldSession.patch({ libraryView: "albums" })}>我的专题 · {catalogStore.albums.length}</button></div>{/if}
      <div class="filters">
        <div class="kind-tabs" aria-label="内容分类">{#each kinds as kind}<button class:active={snapshot.kind === kind.id} aria-pressed={snapshot.kind === kind.id} onclick={() => handheldSession.patch({ kind: kind.id, scrollOffset: 0 })}>{kind.label}</button>{/each}</div>
        {#if tab !== "discover"}<label><span class="sr-only">筛选</span><select aria-label="内容筛选" value={snapshot.filter} onchange={e => handheldSession.patch({ filter: e.currentTarget.value as typeof snapshot.filter })}><option value="all">所有内容</option><option value="favorites">收藏</option><option value="local">本机可用</option></select></label><label><span class="sr-only">排序</span><select aria-label="内容排序" value={snapshot.sort} onchange={e => handheldSession.patch({ sort: e.currentTarget.value as typeof snapshot.sort })}><option value="recent">最近使用</option><option value="title">名称排序</option></select></label>{:else}<button onclick={() => showPanel("search")}>搜索</button>{/if}
      </div>
      {#if tab === "discover"}
        <div class="discovery"><Discovery query={snapshot.query} kind={snapshot.kind} request={searchRequest} /></div>
      {:else if rows.length}
        <div class="collection" class:dense={displayProfile.profile.density === "compact"}>
          <div class="list-area"><VirtualList bind:this={list} items={rows} itemKey={item => item.id} columns={galleryColumns} estimateSize={galleryRowHeight} focusId={selected?.id} initialScrollOffset={snapshot.scrollOffset} onselect={item => select(item)} onscroll={offset => handheldSession.patch({ scrollOffset: offset })} label="全部作品封面网格">
            {#snippet children(item)}
              <div class="gallery-card" class:selected={selected?.id === item.id}>
                <button class="content-row" class:selected={selected?.id === item.id} data-focus-key={item.id} aria-label={item.title + "，" + item.progressLabel} onclick={() => select(item)} ondblclick={() => void handheldContentStore.activate(item)} onfocus={() => select(item)}>
                  <span class="gallery-art">{#if item.cover?.src && !failedImages.includes(item.cover.src)}<img src={item.cover.src} alt="" loading="lazy" decoding="async" onerror={() => imageFailed(item.cover!.src)} />{:else}<Icon name={item.kind === "game" ? "gamepad" : item.kind === "anime" ? "film" : item.kind === "comic" ? "image" : "book"} size={42} stroke={1.1} />{/if}</span>
                  <span class="row-copy"><small>{labels[item.kind]}{item.favorite ? " · 已收藏" : ""}</small><strong>{item.title}</strong><span>{item.progressLabel}</span></span>
                </button>
                {#if selected?.id === item.id}<button class="card-action" disabled={!item.actions.some(action => (action.id === "open" || action.id === "launch") && action.enabled)} onclick={() => void handheldContentStore.activate(item)}><Icon name="play" size={16} />{item.primaryLabel}</button>{/if}
              </div>
            {/snippet}
          </VirtualList></div>
        </div>
      {:else}
        <div class="empty"><span class="empty-symbol" aria-hidden="true">◈</span><h2>这里还没有内容</h2><p>{snapshot.filter === "local" ? "仅展示已确认在本机可用的内容。" : "游玩、观看或阅读后，可以从这里接着继续。"}</p><div><button class="primary" onclick={() => switchTab("library")}>打开藏馆</button><button onclick={() => void gameStore.importGame()}>导入游戏</button><button onclick={() => showPanel("search")}>搜索内容</button></div></div>
      {/if}
    {/if}
  </main>
  <footer class="hints"><span><kbd>{glyph("launch")}</kbd>{panel ? "确认" : currentAction}</span><span><kbd>{glyph("back")}</kbd>返回</span>{#if browse && featured && (tab === "continue" || tab === "library")}<span><kbd>{glyph("favorite")}</kbd>作品操作</span>{/if}{#if browse}<span><kbd>{glyph("activate")}</kbd>搜索</span><span class="shoulder-hint"><kbd>{glyph("pageLeft")} / {glyph("pageRight")}</kbd>栏目</span>{/if}<button onclick={() => showPanel("quick")}>{taskActiveCount ? taskActiveCount + " 项任务" : "快捷设置"}</button></footer>
  <Drawer open={panel !== null && panel !== "wheel"} title={panel === "search" ? "搜索内容" : panel === "quick" ? "快捷面板" : panel === "album-picker" ? "加入专题" : featured?.title || "内容面板"} onClose={dismissPanel} bind:ref={panelRoot} class="handheld-drawer" initialFocus={panel === "search" ? "input" : "auto"} returnFocus={false}>
    {#if panel === "search"}
      <form onsubmit={e => { e.preventDefault(); submitSearch(); }}><label class="field">作品名称<input bind:this={searchInput} bind:value={searchText} type="search" placeholder="支持中文、日文与英文" autocomplete="off" oncompositionstart={() => composing = true} oncompositionend={() => composing = false} /></label><label class="field">搜索范围<select bind:value={searchKind}>{#each kinds as kind}<option value={kind.id}>{kind.label}</option>{/each}</select></label><div class="panel-actions"><button type="button" onpointerdown={e => e.preventDefault()} onclick={keyboard}>打开键盘</button><button type="submit" class="primary" disabled={!searchText.trim() || composing}>搜索</button></div></form>
      {#if localSearch.length}<div class="local-results"><span>本机作品与专题 · 可直接打开</span>{#each localSearch as result (result.entry.id)}<button onclick={() => openSearchResult(result.entry)}><strong>{result.entry.label}</strong><small>{result.entry.hint}</small></button>{/each}</div>{/if}
      {#if keyboardMessage}<p role="status">{keyboardMessage}</p>{/if}<div class="keyboard-settings"><button onclick={() => openKeyboardSettings("touch")}>触摸键盘设置</button><button onclick={() => openKeyboardSettings("accessibility")}>辅助键盘</button></div>
    {:else if panel === "album-picker"}
      {#if featured}<p>将《{featured.title}》加入个人专题。</p>{/if}<div class="album-picks">{#each catalogStore.albums as album (album.id)}<button onclick={() => void addToAlbum(album.id)}>{album.title}<small>{album.members.length} 部作品</small></button>{/each}</div><button onclick={() => { dismissPanel(); switchTab("library"); handheldSession.patch({ libraryView: "albums", albumId: null }); }}>创建新专题</button>
    {:else if panel === "quick"}
      <label class="field">显示舒适度 <strong>{displayProfile.profile.comfort}%</strong><input type="range" min="90" max="130" step="5" value={displayProfile.profile.comfort} oninput={e => displayProfile.update({ comfort: Number(e.currentTarget.value) })} /></label><label class="field">内容密度<select value={displayProfile.profile.density} onchange={e => displayProfile.update({ density: e.currentTarget.value as "comfortable" | "compact" })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><label class="check"><input type="checkbox" checked={displayProfile.profile.lightEffects} onchange={e => displayProfile.update({ lightEffects: e.currentTarget.checked })} />轻量效果</label><p>仅调整界面；分辨率变化不会退出掌机模式。</p><button onclick={() => { dismissPanel(); navigateTo("tasks"); }}>查看任务 · {taskActiveCount} 项进行中</button><button onclick={() => { dismissPanel(); displayProfile.update({ mode: "desktop" }); }}>切回原界面</button>
    {:else if featured}
      <p>{featured.progressLabel}</p><p>{featured.description || featured.subtitle}</p><div class="panel-actions"><button class="primary" disabled={!primary?.enabled} onclick={runPrimary}>{featured.primaryLabel}</button>{#each featured.actions.filter(a => a.id !== "launch" && a.id !== "open") as action}<button disabled={!action.enabled} onclick={() => void action.run()}>{action.label}</button>{/each}<button onclick={() => showPanel("album-picker")}>加入专题</button><button onclick={() => { const item = featured; dismissPanel(); if (item) void handheldContentStore.openDetails(item); }}>详情与章节</button></div><p>选集、线路和阅读偏好在播放或阅读中的内容面板里调整。</p>
    {/if}
  </Drawer>
  {#if panel === "wheel" && featured}<ActionWheel title={featured.title} cover={featured.cover?.src} entries={wheelEntries} activeIndex={wheelIndex} onselect={index => wheelIndex = index} onrun={runWheel} onclose={dismissPanel} compact={metrics.compact || size.height < 640} bind:ref={wheelRoot} />{/if}
</div>

<style>
  .handheld-shell {width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;padding-bottom:var(--hh-keyboard);box-sizing:border-box;font:500 var(--hh-body)/1.5 var(--font-ui,sans-serif);overflow:hidden;position:relative;}
  .light :global(*) {animation:none!important;}
  .header {display:flex;align-items:center;flex-shrink:0;} nav {display:flex;flex:1;}
  button,select,input {font:inherit;} button,select {min-height:var(--hh-target);padding:8px 18px;cursor:pointer;} button:disabled {opacity:.5;cursor:default;}
  .body {flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
  .body > :global(.album-index),.body > :global(.album-detail) {flex:1;min-height:0;}
  .section-heading {display:flex;align-items:end;justify-content:space-between;gap:16px;}
  h1 {margin:0;font-weight:760;} h2 {font-size:clamp(22px,2.2vw,40px);line-height:1.25;margin:10px 0;}
  .section-heading>span {font-size:var(--hh-aux);max-width:45%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
  .library-switch {display:flex;align-items:center;flex:none;}
  .filters {display:flex;align-items:center;flex-shrink:0;}.kind-tabs {display:flex;flex:1;min-width:0;overflow:auto;}
  .filters select {font-size:var(--hh-aux);padding:8px;}
  .list-area {min-height:0;overflow:hidden;}
  .row-copy {min-width:0;}.row-copy strong,.row-copy small,.row-copy>span {display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .row-copy small,.row-copy>span {font-size:var(--hh-aux);}
  .panel-actions {display:flex;gap:10px;flex-wrap:wrap;}
  p {color:var(--hh-muted);font-size:var(--hh-aux);}
  .hints {display:flex;align-items:center;gap:20px;padding:4px calc(var(--hh-gap)*2);font-size:var(--hh-aux);flex-shrink:0;}
  .hints>span {display:flex;gap:7px;align-items:center;white-space:nowrap;}
  kbd {min-width:23px;text-align:center;font:650 12px/22px var(--font-ui,sans-serif);padding:0 4px;}
  .hints button {margin-left:auto;font-size:var(--hh-aux);}
  .empty {margin:auto;max-width:680px;text-align:center;}.empty-symbol {font-size:48px;}.empty>div {display:flex;justify-content:center;gap:12px;flex-wrap:wrap;}
  .tools {display:grid;gap:var(--hh-gap);overflow:auto;}.tools button {text-align:left;padding:20px;}.tools small {display:block;margin-top:8px;font-size:var(--hh-aux);}
  .discovery {flex:1;min-height:0;}.inner {padding:0;gap:0;}.inner-heading {display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 16px;font-size:var(--hh-aux);flex-shrink:0;}
  .inner-heading button {font-size:var(--hh-aux);}.route-content {position:relative;flex:1;min-height:0;overflow:hidden;contain:layout paint;isolation:isolate;z-index:1;}
  .field {display:flex;flex-direction:column;gap:12px;margin:0 0 20px;}.field input:not([type=range]) {min-height:48px;border-radius:10px;padding:12px;width:100%;box-sizing:border-box;}
  .field input[type=range] {min-height:44px;width:100%;accent-color:var(--hh-action);}.check {display:flex;gap:12px;align-items:center;min-height:48px;}.check input {width:24px;height:24px;}
  .keyboard-settings {display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;}.keyboard-settings button {font-size:14px;}
  .local-results,.album-picks {display:grid;gap:5px;max-height:34vh;overflow:auto;margin:14px 0;padding:10px 0;}
  .local-results button,.album-picks button {display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;}
  .local-results strong {flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
  .sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  :global(.handheld-drawer) {bottom:var(--hh-keyboard,0)!important;font-size:var(--hh-body,18px);max-height:100dvh;}
  .compact .shoulder-hint {display:none;}.compact .filters {flex-wrap:wrap;}.compact .kind-tabs {flex-basis:100%;}.compact .hints {gap:10px;padding:4px 10px;}.compact :global(.handheld-drawer) {width:100%!important;max-width:100%!important;}
  @media(max-height:550px) {.filters {gap:4px;}.filters select {max-width:110px;}}
  @media(prefers-reduced-motion:reduce) {.handheld-shell * {scroll-behavior:auto!important;}}
  /* 清透掌机视觉层。动态 --hh-accent 由壳层统一下发。 */
  .handheld-shell {--hh-muted:#657085;--hh-action:color-mix(in srgb,var(--hh-accent) 70%,#403198);background:linear-gradient(155deg,#fafaff,#f4f5fa 58%,#edeffa);color:#202535;}
  .handheld-shell.light {background:#f4f5fa;}
  .header {background:#ffffffdc;border-bottom:1px solid #dfe1ec;backdrop-filter:blur(14px);padding:10px calc(var(--hh-gap)*1.75);gap:12px;}
  .light .header,.light .hints {backdrop-filter:none;}
  .brand {font-size:22px;color:#5748ad;letter-spacing:-.045em;white-space:nowrap;}.brand span {color:#273047;}
  .header nav {justify-content:center;gap:4px;}
  .header nav button {border-radius:999px;min-height:44px;padding:8px 19px;font-weight:720;background:transparent;color:#566174;}
  .header nav button.active,.header nav button.active:hover {color:#4d3e9c;background:#edeafb;box-shadow:inset 0 0 0 1px #b6afe8;}
  .handheld-shell button,.handheld-shell select {border-radius:12px;color:#202535;background:#ffffffbc;border:1px solid #d8dae7;}
  .handheld-shell button:hover {background:#f0eefb;}
  .handheld-shell button:focus-visible,.handheld-shell select:focus-visible,.handheld-shell input:focus-visible {outline:3px solid #5849b4;outline-offset:2px;}
  .icon-button {display:grid;place-items:center;padding:0;min-width:var(--hh-target);background:#fff;}
  .body {padding:calc(var(--hh-gap)*1.1) calc(var(--hh-gap)*1.75);gap:calc(var(--hh-gap)*.85);}
  .section-heading {min-height:48px;}.section-heading h1 {font-size:clamp(25px,2.5vw,40px);letter-spacing:-.035em;}
  .section-heading>span {color:#697186;}
  .library-switch {border:0;padding:0;gap:5px;}.library-switch button {min-height:44px;border-radius:999px;background:transparent;border-color:transparent;padding-inline:18px;}
  .library-switch button.active {background:#e8e5f8;color:#4f4299;border:1px solid #bbb3e6;font-weight:740;}
  .filters {gap:10px;}.kind-tabs {gap:5px;}.kind-tabs button {background:transparent;border-color:transparent;border-radius:999px;min-height:44px;padding:7px 17px;color:#596377;}
  .kind-tabs button.active {color:#4e3f9d;background:#e8e5f8;border-color:#bbb3e6;}
  .filters select {background:#fff;border-color:#d6d9e6;color:#273047;} option {background:#fff;color:#273047;}
  .collection {display:block;flex:1;min-height:0;}.list-area {height:100%;}.list-area :global(.wh-virtual-list) {--wh-gap:14px;}
  .gallery-card {position:relative;width:100%;height:100%;overflow:hidden;border:1px solid #dce0ed;border-radius:16px;background:#fff;box-shadow:0 3px 12px #343f6210;box-sizing:border-box;}
  .gallery-card.selected {border:2px solid var(--hh-action);box-shadow:0 8px 22px #5d52a62c;}
  .content-row,.content-row.selected {width:100%;height:100%;min-height:0;display:flex;flex-direction:column;align-items:stretch;gap:0;text-align:left;padding:7px;border:0;border-radius:14px;background:transparent;box-shadow:none;}
  .content-row:hover,.content-row.selected:hover {background:transparent;}
  .gallery-art {display:grid;place-items:center;flex:1;min-height:0;overflow:hidden;border-radius:11px;background:linear-gradient(135deg,#ebe8f9,#f7f6fb 66%,#eaf0f8);color:#7d70be;}
  .gallery-art img {width:100%;height:100%;object-fit:contain;border-radius:0;}
  .row-copy {height:64px;flex:none;padding:6px 2px 0;display:flex;flex-direction:column;gap:0;box-sizing:border-box;}
  .row-copy small {color:#6252b4;font-size:12px;}.row-copy strong {color:#273047;font-weight:740;}.row-copy>span {color:#687386;}
  .card-action {position:absolute;top:calc(100% - 111px);right:12px;min-height:44px;max-width:calc(100% - 24px);display:flex;align-items:center;gap:4px;padding:6px 10px;color:#fff!important;background:var(--hh-action)!important;border:0!important;border-radius:10px!important;font-size:13px;font-weight:730;box-shadow:0 4px 12px #3d318665;}
  .handheld-shell .primary {background:var(--hh-action);color:#fff;border:1px solid transparent;border-radius:12px;font-weight:740;}
  .handheld-shell .primary:hover {background:color-mix(in srgb,var(--hh-action) 82%,#261b67);}
  .tools {grid-template-columns:repeat(3,minmax(0,1fr));}.tools button {background:#fff;border-color:#e1e3ee;border-radius:16px;box-shadow:0 3px 14px #2d38570d;}
  .tools small {color:#697186;}.empty-symbol {color:#7464c4;}.empty p,.handheld-shell p {color:#657085;}
  .hints {min-height:54px;background:#ffffffdc;border-top:1px solid #dfe1eb;backdrop-filter:blur(14px);gap:18px;}
  .hints kbd {border:1px solid #b9b2df;color:#5647a7;border-radius:7px;background:#f4f1ff;}
  .hints button {border:0;background:transparent;color:#5748a7;}
  .inner-heading {background:#f4f5fa;color:#202535;border-bottom:1px solid #e1e3ef;}
  .handheld-shell .field input:not([type=range]),.handheld-shell .field select {background:#fff;color:#202535;border-color:#d5d9e7;}
  :global(.handheld-drawer) {background:#fbfbff!important;color:#202535!important;border-left:1px solid #dfe1eb!important;box-shadow:-16px 0 42px #34385c2e;width:min(540px,48vw)!important;}
  :global(.handheld-drawer button),:global(.handheld-drawer select),:global(.handheld-drawer input) {color:#202535;background:#fff;border-color:#d5d9e7;border-radius:12px;}
  :global(.handheld-drawer .v2-drawer__close) {min-width:44px;min-height:44px;}
  :global(.handheld-drawer .primary) {background:var(--hh-action)!important;color:#fff!important;}
  .local-results,.album-picks {border-top:1px solid #dfe1ec;}.local-results>span {color:#594aae;font-weight:700;}.local-results small,.album-picks small {color:#657085;}
  .local-results button,.album-picks button {min-height:52px;border-radius:12px;background:#fff;}
  @media(max-width:960px) {.header {gap:5px;padding:7px 10px;}.header nav button {padding:7px 11px;}.brand {display:none;}.body:not(.inner) {padding:10px;gap:8px;}.gallery-card {border-radius:13px;}.tools {grid-template-columns:repeat(2,minmax(0,1fr));}}
  @media(max-height:550px) {.hints {min-height:44px;}.section-heading {min-height:36px;}.header nav button {min-height:44px;}}
</style>
