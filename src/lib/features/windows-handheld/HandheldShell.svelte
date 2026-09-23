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
  let accentColor = $state("#ed6b74");
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
    accentColor = "#ed6b74";
    if (source) void loadAdaptiveChromaPalette(source).then(palette => {
      if (current && palette.source === "media") accentColor = `rgb(${palette.accent.r},${palette.accent.g},${palette.accent.b})`;
    }).catch(() => {});
    return () => { current = false; };
  });
  const primary = $derived(featured?.actions.find(action => action.id === "launch" || action.id === "open"));
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
    <span class="brand">M<span>OE</span></span>
    <nav aria-label="掌机主栏目">{#each tabs as item}<button class:active={tab === item.id && browse} aria-current={tab === item.id && browse ? "page" : undefined} onclick={() => switchTab(item.id)}>{item.label}</button>{/each}</nav>
    <button class="icon-button" aria-label="搜索内容" onclick={() => showPanel("search")}>⌕</button>
    <button class="icon-button" aria-label="快捷面板" onclick={() => showPanel("quick")}>☰</button>
  </header>
  <main class="body" class:inner={!browse}>
    {#if !browse}
      <div class="inner-heading"><button onclick={back}>← 返回{tabs.find(t => t.id === tab)?.label}</button><span>{getViewLabel(uiStore.currentView)}</span><button onpointerdown={e => e.preventDefault()} onclick={keyboard}>打开键盘</button></div>
      <div class="route-content">{@render children()}</div>
    {:else if tab === "mine"}
      <div class="section-heading"><div><p>MY SPACE</p><h1>我的</h1></div><span>内容与偏好都留在这里</span></div>
      <div class="tools">
        <button onclick={() => { switchTab("library"); handheldSession.patch({ filter: "all", kind: "all" }); }}>完整历史与内容库 <small>按最近使用排序</small></button>
        <button onclick={() => { switchTab("library"); handheldSession.patch({ filter: "favorites", kind: "all" }); }}>收藏 <small>已收藏的游戏与媒体</small></button>
        <button onclick={() => void gameStore.importGame()}>导入本地游戏 <small>选择本机可执行文件</small></button>
        {#each [{view:"steam-import",label:"平台导入",sub:"Steam 游戏库"},{view:"tasks",label:"任务",sub:`${taskActiveCount} 项进行中 · ${taskFailedCount} 项失败`},{view:"sources",label:"来源",sub:"搜索、解析与可用状态"},{view:"downloads",label:"离线与下载",sub:"本机下载任务"},{view:"backup",label:"游戏存档备份",sub:"现有存档备份与恢复"},{view:"settings",label:"设置与同步",sub:"WebDAV、显示与手柄"}] as tool}<button onclick={() => navigateTo(tool.view)}>{tool.label}<small>{tool.sub}</small></button>{/each}
      </div>
    {:else if tab === "continue"}
      <EditorialContinue items={rows} {selected} onselect={select} onopen={item => void handheldContentStore.activate(item)} onmore={() => showPanel("wheel")} onalbum={openAlbum} onlibrary={() => switchTab("library")} onsearch={() => showPanel("search")} />
    {:else if tab === "library" && snapshot.libraryView === "albums"}
      <div class="library-switch"><button onclick={() => handheldSession.patch({ libraryView: "all" })}>全部作品</button><button class="active">我的专题</button></div>
      <AlbumView items={handheldContentStore.library} activeAlbumId={snapshot.albumId} activeMemberId={snapshot.albumMemberId} onalbum={id => { albumFocusedItem = null; handheldSession.patch({ albumId: id, albumMemberId: null }); }} onmember={id => handheldSession.patch({ albumMemberId: id })} onselect={item => { albumFocusedItem = item; if (item) select(item); }} onopen={item => void handheldContentStore.activate(item)} onsearch={searchFor} />
    {:else}
      <div class="section-heading"><div><p>{tab === "library" ? "THE COMPLETE INDEX" : "FIND YOUR NEXT STORY"}</p><h1>{tab === "library" ? "全部作品" : "发现"}</h1></div><span>{tab === "discover" ? snapshot.query || "按名称搜索作品" : `${rows.length} 项内容`}</span></div>
      {#if tab === "library"}<div class="library-switch"><button class="active">全部作品</button><button onclick={() => handheldSession.patch({ libraryView: "albums" })}>我的专题 · {catalogStore.albums.length}</button></div>{/if}
      <div class="filters">
        <div class="kind-tabs" aria-label="内容分类">{#each kinds as kind}<button class:active={snapshot.kind === kind.id} aria-pressed={snapshot.kind === kind.id} onclick={() => handheldSession.patch({ kind: kind.id, scrollOffset: 0 })}>{kind.label}</button>{/each}</div>
        {#if tab !== "discover"}<label><span class="sr-only">筛选</span><select aria-label="内容筛选" value={snapshot.filter} onchange={e => handheldSession.patch({ filter: e.currentTarget.value as typeof snapshot.filter })}><option value="all">所有内容</option><option value="favorites">收藏</option><option value="local">本机可用</option></select></label><label><span class="sr-only">排序</span><select aria-label="内容排序" value={snapshot.sort} onchange={e => handheldSession.patch({ sort: e.currentTarget.value as typeof snapshot.sort })}><option value="recent">最近使用</option><option value="title">名称排序</option></select></label>{:else}<button onclick={() => showPanel("search")}>搜索</button>{/if}
      </div>
      {#if tab === "discover"}
        <div class="discovery"><Discovery query={snapshot.query} kind={snapshot.kind} request={searchRequest} /></div>
      {:else if rows.length}
        <div class="collection" class:dense={displayProfile.profile.density === "compact"}>
          <div class="list-area"><VirtualList bind:this={list} items={rows} itemKey={item => item.id} estimateSize={displayProfile.profile.density === "compact" ? Math.max(76, metrics.target + 26) : Math.max(104, metrics.target + 52)} focusId={selected?.id} initialScrollOffset={snapshot.scrollOffset} onselect={item => select(item)} onscroll={offset => handheldSession.patch({ scrollOffset: offset })}>
            {#snippet children(item)}<button class="content-row" class:selected={selected?.id === item.id} data-focus-key={item.id} aria-label={`${item.title}，${item.progressLabel}`} onclick={() => select(item)} ondblclick={() => void handheldContentStore.activate(item)} onfocus={() => select(item)}>{#if item.cover?.src}<img src={item.cover.src} alt="" loading="lazy" decoding="async" />{:else}<span class="cover-placeholder" aria-hidden="true">{labels[item.kind]}</span>{/if}<span class="row-copy"><small>{labels[item.kind]}{item.favorite ? " · 已收藏" : ""}</small><strong>{item.title}</strong><span>{item.progressLabel}</span></span><span class="row-arrow" aria-hidden="true">›</span></button>{/snippet}
          </VirtualList></div>
          {#if selected}<aside class="feature" aria-label="当前作品"><div class="hero">{#if selected.hero?.src || selected.cover?.src}<img src={selected.hero?.src || selected.cover?.src} alt="" loading="lazy" />{:else}<span>{labels[selected.kind]}</span>{/if}</div><div class="feature-copy"><small>{labels[selected.kind]} · {selected.subtitle || "随时继续"}</small><h2>{selected.title}</h2><p>{selected.progressLabel}</p>{#if selected.progress !== null}<progress value={selected.progress} max="1" aria-label="内容进度"></progress>{/if}<div class="feature-actions"><button class="primary" disabled={!primary?.enabled} onclick={runPrimary}>{selected.primaryLabel}</button><button onclick={() => showPanel("wheel")}>作品操作</button></div></div></aside>{/if}
        </div>
      {:else}
        <div class="empty"><span class="empty-symbol" aria-hidden="true">◈</span><h2>这里还没有内容</h2><p>{snapshot.filter === "local" ? "仅展示已确认在本机可用的内容。" : "游玩、观看或阅读后，可以从这里接着继续。"}</p><div><button class="primary" onclick={() => switchTab("library")}>打开藏馆</button><button onclick={() => void gameStore.importGame()}>导入游戏</button><button onclick={() => showPanel("search")}>搜索内容</button></div></div>
      {/if}
    {/if}
  </main>
  <footer class="hints"><span><kbd>{glyph("launch")}</kbd>{panel ? "确认" : browse && featured && tab !== "mine" && tab !== "discover" ? featured.primaryLabel : "确认"}</span><span><kbd>{glyph("back")}</kbd>返回</span><span><kbd>{glyph("favorite")}</kbd>作品操作</span><span><kbd>{glyph("activate")}</kbd>搜索</span><span class="shoulder-hint"><kbd>{glyph("pageLeft")} / {glyph("pageRight")}</kbd>栏目</span><button onclick={() => showPanel("quick")}>{taskActiveCount ? `${taskActiveCount} 项任务` : "快捷设置"}</button></footer>
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
  {#if panel === "wheel" && featured}<ActionWheel title={featured.title} entries={wheelEntries} activeIndex={wheelIndex} onselect={index => wheelIndex = index} onrun={runWheel} onclose={dismissPanel} compact={metrics.compact || size.height < 680} bind:ref={wheelRoot} />{/if}
</div>

<style>
  .inner-heading {position:relative;z-index:2;flex-shrink:0;background:#111119;}
  .route-content {contain:layout paint;isolation:isolate;z-index:1;}
  .light :global(*) {animation:none!important;} .light :global(.wheel-backdrop) {backdrop-filter:none;}
  .handheld-shell { --hh-accent:#b6a4ff;--hh-muted:#aaa9bd; width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;padding-bottom:var(--hh-keyboard);box-sizing:border-box;background:radial-gradient(ellipse at 80% 0%,#30294866,transparent 60%),#101018;color:#f2efff;font:500 var(--hh-body)/1.5 var(--font-ui,sans-serif);overflow:hidden;position:relative; }
  .light {background:#111119;} .header {display:flex;align-items:center;gap:var(--hh-gap);padding:12px calc(var(--hh-gap)*2);border-bottom:1px solid #ffffff12;flex-shrink:0;} .brand {font-size:24px;font-weight:900;letter-spacing:-2px;color:var(--hh-accent);} .brand span {color:#fff;} nav {display:flex;gap:8px;flex:1;}
  button,select,input {font:inherit;} button,select {min-height:var(--hh-target);border:1px solid #ffffff1c;border-radius:12px;padding:8px 18px;color:inherit;background:#ffffff06;cursor:pointer;} button:disabled {opacity:.45;cursor:default;} button:hover {background:#ffffff10;} button:focus-visible,input:focus-visible,select:focus-visible {outline:3px solid var(--hh-accent);outline-offset:-3px;} nav button,.kind-tabs button {border:0;background:transparent;white-space:nowrap;} button.active {color:#ded5ff;background:#b6a4ff1b;} .icon-button {font-size:26px;padding:0;min-width:var(--hh-target);} .body {flex:1;min-height:0;padding:calc(var(--hh-gap)*1.5) calc(var(--hh-gap)*2);display:flex;flex-direction:column;gap:var(--hh-gap);overflow:hidden;} .section-heading {display:flex;align-items:end;justify-content:space-between;gap:16px;} h1 {font-size:clamp(24px,2.6vw,48px);margin:0;font-weight:750;} .section-heading p {margin:0 0 2px;color:var(--hh-accent);font-size:11px;letter-spacing:2px;} .section-heading>span {font-size:var(--hh-aux);color:var(--hh-muted);max-width:45%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;} .filters {display:flex;align-items:center;gap:8px;flex-shrink:0;} .kind-tabs {display:flex;flex:1;gap:2px;min-width:0;overflow:auto;} .filters select {font-size:var(--hh-aux);padding:8px;} option {background:#20202c;} .collection {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.02fr);gap:calc(var(--hh-gap)*1.5);flex:1;min-height:0;} .list-area {min-height:0;overflow:hidden;} .content-row {display:flex;align-items:center;text-align:left;gap:var(--hh-gap);padding:10px;width:100%;height:100%;min-height:76px;overflow:hidden;background:#ffffff03;border-color:transparent;} .content-row.selected {background:#b6a4ff14;border-color:#b6a4ff66;} .content-row img,.cover-placeholder {width:72px;height:78px;object-fit:cover;border-radius:8px;flex-shrink:0;} .cover-placeholder {display:grid;place-items:center;background:linear-gradient(135deg,#413451,#252633);color:var(--hh-muted);font-size:14px;} .row-copy {min-width:0;flex:1;} .row-copy strong {display:block;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .row-copy small,.row-copy>span {display:block;font-size:var(--hh-aux);color:var(--hh-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .row-copy small {color:#beb0ea;} .row-arrow {color:var(--hh-accent);font-size:24px;} .dense .content-row img,.dense .cover-placeholder {height:54px;width:50px;} .feature {min-height:0;overflow:auto;border:1px solid #ffffff14;border-radius:20px;background:#ffffff04;display:flex;flex-direction:column;} .hero {position:relative;flex:1;min-height:60px;max-height:55%;overflow:hidden;background:linear-gradient(130deg,#352c45,#171923);display:grid;place-items:center;font-size:48px;color:#9e8dc4;} .hero img {width:100%;height:100%;object-fit:cover;} .feature-copy {padding:calc(var(--hh-gap)*1.5);} .feature-copy small {font-size:var(--hh-aux);color:#beb0ea;} h2 {font-size:clamp(22px,2.2vw,40px);line-height:1.25;margin:10px 0;} p {color:var(--hh-muted);font-size:var(--hh-aux);} .feature-actions,.panel-actions {display:flex;gap:10px;flex-wrap:wrap;} .primary {background:#c4b4ff;color:#1a132c;border-color:transparent;font-weight:750;} .primary:hover {background:#d3c7ff;} .feature-actions .primary {flex:1;} progress {width:100%;height:5px;accent-color:var(--hh-accent);margin-bottom:16px;} .hints {display:flex;gap:20px;align-items:center;min-height:56px;padding:4px calc(var(--hh-gap)*2);border-top:1px solid #ffffff12;font-size:var(--hh-aux);flex-shrink:0;} .hints>span {display:flex;gap:7px;align-items:center;white-space:nowrap;} kbd {border:1px solid #ffffff44;border-radius:7px;min-width:23px;text-align:center;font:650 12px/22px var(--font-ui,sans-serif);padding:0 4px;color:#ddd6f0;} .hints button {margin-left:auto;font-size:var(--hh-aux);border:0;} .empty {margin:auto;max-width:680px;text-align:center;} .empty-symbol {font-size:48px;color:var(--hh-accent);} .empty>div {display:flex;justify-content:center;gap:12px;flex-wrap:wrap;} .tools {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--hh-gap);overflow:auto;} .tools button {text-align:left;padding:20px;} .tools small {display:block;margin-top:8px;color:var(--hh-muted);font-size:var(--hh-aux);} .discovery {flex:1;min-height:0;} .inner {padding:0;gap:0;} .inner-heading {display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 16px;font-size:var(--hh-aux);} .inner-heading button {font-size:var(--hh-aux);} .route-content {position:relative;flex:1;min-height:0;overflow:hidden;} .field {display:flex;flex-direction:column;gap:12px;margin:0 0 20px;} .field input:not([type=range]) {min-height:48px;border:1px solid #ffffff33;background:#ffffff08;color:inherit;border-radius:10px;padding:12px;width:100%;box-sizing:border-box;} .field input[type=range] {min-height:44px;width:100%;accent-color:var(--hh-accent);} .check {display:flex;gap:12px;align-items:center;min-height:48px;} .check input {width:24px;height:24px;} .keyboard-settings {display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;} .keyboard-settings button {font-size:14px;} .sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  :global(.handheld-drawer) {color:#f2efff;background:#1c1b28!important;width:min(520px,48vw)!important;bottom:var(--hh-keyboard,0)!important;font-size:var(--hh-body,18px);max-height:100dvh;}
  .compact .brand,.compact .section-heading p,.compact .shoulder-hint {display:none;} .compact .header {padding:8px 12px;gap:6px;} .compact .header nav {gap:0;} .compact nav button {padding:6px 14px;} .compact .body:not(.inner) {padding:12px;gap:10px;} .compact .filters {flex-wrap:wrap;} .compact .kind-tabs {flex-basis:100%;} .compact .kind-tabs button {padding:6px 14px;} .compact .collection {grid-template-columns:minmax(0,1fr) minmax(0,.8fr);gap:12px;} .compact .hero {display:none;} .compact .feature-copy {padding:14px;} .compact .hints {gap:12px;padding:4px 12px;} .compact .tools {grid-template-columns:repeat(2,minmax(0,1fr));} .compact :global(.handheld-drawer) {width:100%!important;max-width:100%!important;}
  @media(max-height:550px) { .section-heading {display:none;} .filters {gap:4px;} .compact .kind-tabs {flex-basis:auto;} .filters select {max-width:110px;} .feature-copy {padding:10px;} .hero {display:none;} .hints {min-height:44px;} .feature-copy h2 {font-size:22px;} .feature-copy p {margin:6px 0;} .feature-copy small {display:none;} }
  @media(prefers-reduced-motion:reduce) { .handheld-shell * {scroll-behavior:auto!important;} }
  /* The handheld issue uses the same editorial surface for navigation and content. */
  .handheld-shell { --hh-muted:#c1bdb9;background:#111318;color:#f5f0e7; }
  .header {background:#17191f;border-bottom:2px solid var(--hh-accent);}
  .brand {color:var(--hh-accent);letter-spacing:-.08em;}
  .header nav button {border-radius:2px;font-weight:700;}
  .header nav button.active {color:#111318;background:var(--hh-accent);}
  .body {min-height:0;}
  .body > :global(.album-index),.body > :global(.album-detail) {flex:1;min-height:0;}
  .library-switch {display:flex;gap:8px;align-items:center;flex:none;border-bottom:1px solid #f5f0e73d;padding-bottom:8px;}
  .library-switch button {border-radius:3px;min-height:44px;}
  .library-switch button.active {background:var(--hh-accent);color:#111318;border-color:var(--hh-accent);font-weight:800;}
  .section-heading p {color:var(--hh-accent);}
  .content-row {border-radius:3px;}
  .content-row.selected {background:#ed6b741f;border-color:#ed6b7488;}
  .row-copy small,.row-arrow {color:var(--hh-accent);}
  .feature {border-radius:4px;background:#f5f0e710;border-top:3px solid var(--hh-accent);}
  .feature-copy small {color:var(--hh-accent);}
  .primary {background:var(--hh-accent);color:#111318;border-radius:3px;}
  .primary:hover {background:#ff8c91;}
  .hints {background:#17191f;border-top:1px solid #f5f0e73d;}
  .hints kbd {border-radius:3px;color:#f5f0e7;border-color:var(--hh-accent);}
  :global(.handheld-drawer) {background:#202127!important;color:#f5f0e7;border-left:2px solid var(--hh-accent)!important;}
  .local-results,.album-picks {display:grid;gap:5px;max-height:34vh;overflow:auto;margin:14px 0;padding:10px 0;border-top:1px solid #f5f0e73d;}
  .local-results>span {font-size:13px;color:var(--hh-accent);}
  .local-results button,.album-picks button {display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;min-height:46px;border-radius:3px;}
  .local-results strong {flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
  .local-results small,.album-picks small {font-size:12px;color:#c1bdb9;}
  @media(max-width:960px) { .library-switch {padding:0 0 5px;} .header nav button {padding-inline:12px;} }
</style>
