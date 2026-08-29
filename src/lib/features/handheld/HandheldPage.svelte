<script lang="ts">
  // 掌机模式（ES-DE 风格）：系统轮播 + 封面网格 + 详情面板。
  // 手柄优先（dpad 移动 / A 启动 / X 收藏 / LB·RB 切系统），触屏与键盘同效。
  import { onDestroy, onMount } from "svelte";
  import { gameStore } from "../../stores/games.svelte";
  import type { Game } from "../../stores/games.svelte";
  import { uiStore } from "../../stores/ui.svelte";
  import { navigateTo } from "../../stores/router.svelte";
  import { fileSrc } from "../../utils";
  import { coverOf, gameLastPlayed, gameTotalSeconds, heroImageOf } from "../../utils/game";
  import { formatPlayTime } from "../../api";
  import { groupGamesBySystem } from "./systems";
  import { attachGamepad, type GamepadAttachment } from "../../components/switch/useGamepad.svelte";
  import Icon from "../../components/Icon.svelte";

  const MEMORY_KEY = "moeplay-handheld-memory-v1";

  let systemIdx = $state(0);
  let focusIdx = $state(0);
  let padConnected = $state(false);
  let launching = $state<string | null>(null);
  let now = $state(new Date());

  const systems = $derived(groupGamesBySystem(gameStore.allGames));
  const activeSystem = $derived(systems[Math.min(systemIdx, Math.max(systems.length - 1, 0))] ?? null);
  const games = $derived(activeSystem?.games ?? []);
  const focusGame = $derived<Game | null>(games[focusIdx] ?? null);
  const focusCover = $derived(fileSrc(coverOf(focusGame)));
  const focusHero = $derived(fileSrc(heroImageOf(focusGame)));
  const clock = $derived(now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }));

  let gridEl = $state<HTMLElement>();
  let pad: GamepadAttachment | null = null;

  function readMemory() {
    try {
      return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}") as { system?: string; gameId?: string };
    } catch {
      return {};
    }
  }

  function persistMemory() {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify({ system: activeSystem?.id, gameId: focusGame?.id }));
    } catch { /* ignore */ }
  }

  onMount(() => {
    const memory = readMemory();
    const timer = setInterval(() => (now = new Date()), 30_000);
    void gameStore.load().then(() => {
      const sysIdx = systems.findIndex((s) => s.id === memory.system);
      if (sysIdx >= 0) systemIdx = sysIdx;
      const gameIdx = (systems[systemIdx]?.games ?? []).findIndex((g) => g.id === memory.gameId);
      if (gameIdx >= 0) focusIdx = gameIdx;
    });
    pad = attachGamepad(
      {
        left: () => moveFocus(-1),
        right: () => moveFocus(1),
        up: () => moveFocus(-gridColumns()),
        down: () => moveFocus(gridColumns()),
        pageLeft: () => switchSystem(-1),
        pageRight: () => switchSystem(1),
        activate: () => launchFocused(),
        launch: () => launchFocused(),
        favorite: () => toggleFavoriteFocused(),
        back: () => navigateTo("home"),
        start: () => navigateTo("handheld-import"),
      },
      { id: "handheld", zone: "content" },
    );
    if (typeof navigator !== "undefined" && navigator.getGamepads) {
      padConnected = navigator.getGamepads().some((p) => p && p.connected);
    }
    const onPad = (e: GamepadEvent) => (padConnected = e.type === "gamepadconnected" ? true : navigator.getGamepads().some((p) => p && p.connected));
    window.addEventListener("gamepadconnected", onPad);
    window.addEventListener("gamepaddisconnected", onPad);
    window.addEventListener("keydown", onKeydown);
    return () => {
      clearInterval(timer);
      window.removeEventListener("gamepadconnected", onPad);
      window.removeEventListener("gamepaddisconnected", onPad);
      window.removeEventListener("keydown", onKeydown);
    };
  });

  onDestroy(() => {
    pad?.();
    pad = null;
  });

  function gridColumns(): number {
    if (!gridEl) return 4;
    const style = getComputedStyle(gridEl);
    return style.gridTemplateColumns.split(" ").filter(Boolean).length || 4;
  }

  function clampFocus() {
    if (games.length === 0) {
      focusIdx = 0;
      return;
    }
    focusIdx = Math.min(Math.max(focusIdx, 0), games.length - 1);
  }

  function moveFocus(delta: number) {
    if (games.length === 0) return;
    focusIdx = (focusIdx + delta + games.length * 10) % games.length;
    persistMemory();
    scrollFocusIntoView();
  }

  function switchSystem(delta: number) {
    if (systems.length === 0) return;
    systemIdx = (systemIdx + delta + systems.length) % systems.length;
    focusIdx = 0;
    persistMemory();
  }

  function selectSystem(idx: number) {
    systemIdx = idx;
    focusIdx = 0;
    persistMemory();
  }

  function selectGame(idx: number, launch = false) {
    focusIdx = idx;
    persistMemory();
    if (launch) launchFocused();
  }

  async function launchFocused() {
    const game = focusGame;
    if (!game || launching) return;
    launching = game.id;
    uiStore.notify(`正在启动 ${game.name}…`);
    try {
      await gameStore.launch(game.id);
    } finally {
      launching = null;
    }
  }

  function toggleFavoriteFocused() {
    if (focusGame) void gameStore.toggleFavorite(focusGame.id);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    switch (e.key) {
      case "ArrowLeft": moveFocus(-1); break;
      case "ArrowRight": moveFocus(1); break;
      case "ArrowUp": moveFocus(-gridColumns()); break;
      case "ArrowDown": moveFocus(gridColumns()); break;
      case "PageUp": switchSystem(-1); break;
      case "PageDown": switchSystem(1); break;
      case "Enter": launchFocused(); break;
      case "f": case "F": toggleFavoriteFocused(); break;
      case "Escape": navigateTo("home"); break;
      default: return;
    }
    e.preventDefault();
  }

  function scrollFocusIntoView() {
    requestAnimationFrame(() => {
      gridEl
        ?.querySelector(`[data-idx="${focusIdx}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }

  function lastPlayedLabel(game: Game): string {
    const raw = gameLastPlayed(game);
    if (!raw) return "未游玩";
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "未游玩" : `最近 ${date.toLocaleDateString("zh-CN")}`;
  }

  $effect(() => {
    systems.length;
    if (systemIdx >= systems.length) systemIdx = Math.max(systems.length - 1, 0);
    games.length;
    clampFocus();
  });
</script>

<div class="handheld-page" data-testid="handheld-page">
  <!-- 背景：聚焦游戏的 hero/封面模糊铺底 -->
  <div class="hh-backdrop" aria-hidden="true">
    {#if focusHero}
      <img class="hh-backdrop-img" src={focusHero} alt="" />
    {/if}
    <div class="hh-backdrop-shade"></div>
  </div>

  <!-- 顶栏：系统轮播（ES-DE system view） -->
  <header class="hh-topbar">
    <div class="hh-brand">
      <span class="hh-logo">萌游</span>
      <span class="hh-mode">掌机模式</span>
    </div>
    <nav class="hh-systems" aria-label="游戏系统">
      {#each systems as system, i}
        <button
          type="button"
          class="hh-system"
          class:active={i === systemIdx}
          onclick={() => selectSystem(i)}
        >
          <span class="hh-system-label">{system.label}</span>
          <span class="hh-system-count">{system.games.length}</span>
        </button>
      {:else}
        <span class="hh-system-empty">暂无系统</span>
      {/each}
    </nav>
    <div class="hh-status">
      {#if padConnected}<span class="hh-pad-dot" title="手柄已连接"></span>{/if}
      <span class="hh-clock">{clock}</span>
      <button type="button" class="hh-import-btn" onclick={() => navigateTo("handheld-import")}>
        <Icon name="plus" size={14} /> 导入
      </button>
    </div>
  </header>

  {#if systems.length === 0}
    <div class="hh-empty">
      <h1>还没有游戏</h1>
      <p>扫描本机 ROM 目录，把模拟器游戏导入掌机模式；支持 ES-DE 目录约定（按平台分文件夹）与同名封面自动匹配。</p>
      <div class="hh-empty-actions">
        <button type="button" class="hh-cta" onclick={() => navigateTo("handheld-import")}>扫描 ROM 导入</button>
        <button type="button" class="hh-cta secondary" onclick={() => navigateTo("home")}>返回首页</button>
      </div>
    </div>
  {:else}
    <div class="hh-main">
      <!-- 封面网格（ES-DE grid gamelist） -->
      <div class="hh-grid" bind:this={gridEl} role="listbox" aria-label={`${activeSystem?.label ?? ""} 游戏列表`}>
        {#each games as game, i}
          {@const cover = fileSrc(coverOf(game))}
          <button
            type="button"
            class="hh-cell"
            class:focused={i === focusIdx}
            class:launching={launching === game.id}
            data-idx={i}
            role="option"
            aria-selected={i === focusIdx}
            onclick={() => selectGame(i)}
            ondblclick={() => selectGame(i, true)}
          >
            <span class="hh-cell-art">
              {#if cover}
                <img src={cover} alt={game.name} loading="lazy" />
              {:else}
                <span class="hh-cell-placeholder">{game.name.slice(0, 2)}</span>
              {/if}
              {#if game.favorite}<span class="hh-cell-fav">★</span>{/if}
            </span>
            <span class="hh-cell-name">{game.name}</span>
          </button>
        {/each}
      </div>

      <!-- 详情面板 -->
      {#if focusGame}
        <aside class="hh-detail" aria-label="游戏详情">
          <div class="hh-detail-cover">
            {#if focusCover}
              <img src={focusCover} alt={focusGame.name} />
            {:else}
              <span class="hh-cell-placeholder big">{focusGame.name.slice(0, 2)}</span>
            {/if}
          </div>
          <h2 class="hh-detail-title">{focusGame.name}</h2>
          <div class="hh-detail-meta">
            <span class="hh-chip">{activeSystem?.label}</span>
            <span class="hh-meta-item">{lastPlayedLabel(focusGame)}</span>
            <span class="hh-meta-item">{formatPlayTime(gameTotalSeconds(focusGame))}</span>
          </div>
          {#if focusGame.description}
            <p class="hh-detail-desc">{focusGame.description}</p>
          {/if}
          <div class="hh-detail-actions">
            <button type="button" class="hh-cta" onclick={launchFocused} disabled={launching === focusGame.id}>
              {launching === focusGame.id ? "启动中…" : "启动游戏"}
            </button>
            <button type="button" class="hh-cta secondary" onclick={() => navigateTo("game-detail", { entity: { kind: "game", id: focusGame.id } })}>
              详细资料
            </button>
          </div>
        </aside>
      {/if}
    </div>

    <!-- 底部手柄提示条 -->
    <footer class="hh-hints">
      <span><b>✥</b> 移动</span>
      <span><b>A</b> 启动</span>
      <span><b>X</b> 收藏</span>
      <span><b>LB·RB</b> 切换系统</span>
      <span><b>START</b> 导入 ROM</span>
      <span><b>B</b> 返回</span>
    </footer>
  {/if}
</div>

<style>
  .handheld-page {
    position: relative;
    isolation: isolate;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #0a0c12;
    color: #e8eaf0;
    user-select: none;
  }

  .hh-backdrop { position: absolute; inset: 0; z-index: 0; }
  .hh-backdrop-img {
    width: 100%; height: 100%; object-fit: cover;
    filter: blur(28px) saturate(1.1);
    transform: scale(1.15);
    opacity: 0.35;
  }
  .hh-backdrop-shade {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgb(10 12 18 / .82), rgb(10 12 18 / .68) 45%, rgb(10 12 18 / .9));
  }

  .hh-topbar {
    position: relative; z-index: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 18px;
    padding: 14px 24px 10px;
  }
  .hh-brand { display: flex; align-items: baseline; gap: 8px; }
  .hh-logo { font-weight: 800; font-size: 1.15rem; letter-spacing: .04em; color: var(--accent, #ff4d5f); }
  .hh-mode { font-size: .68rem; color: #9aa3b2; letter-spacing: .2em; }

  .hh-systems {
    display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none;
    padding: 4px 2px;
  }
  .hh-system {
    flex: 0 0 auto;
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 16px;
    border: 1px solid rgb(255 255 255 / .1);
    border-radius: 12px;
    background: rgb(255 255 255 / .04);
    color: #c6ccd8;
    font: 600 .85rem/1 var(--font-ui, system-ui);
    cursor: pointer;
    transition: transform .18s ease, background .18s ease, border-color .18s ease, color .18s ease;
  }
  .hh-system.active {
    background: var(--accent, #ff4d5f);
    border-color: var(--accent, #ff4d5f);
    color: #fff;
    transform: scale(1.06);
    box-shadow: 0 6px 24px rgb(255 77 95 / .35);
  }
  .hh-system-count {
    font-family: var(--font-mono, monospace);
    font-size: .72rem;
    opacity: .75;
  }
  .hh-system-empty { color: #67707f; font-size: .85rem; }

  .hh-status { display: inline-flex; align-items: center; gap: 12px; }
  .hh-pad-dot { width: 9px; height: 9px; border-radius: 99px; background: #4ade80; box-shadow: 0 0 8px #4ade80; }
  .hh-clock { font-family: var(--font-mono, monospace); font-size: .85rem; color: #9aa3b2; }
  .hh-import-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 7px 12px; border-radius: 10px;
    border: 1px solid rgb(255 255 255 / .14);
    background: rgb(255 255 255 / .05); color: #dfe4ec;
    font: 600 .78rem/1 var(--font-ui, system-ui); cursor: pointer;
  }

  .hh-main {
    position: relative; z-index: 1;
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 20px;
    padding: 8px 24px 12px;
  }

  .hh-grid {
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    grid-auto-rows: max-content;
    gap: 14px;
    padding: 8px 6px 24px;
    scrollbar-width: thin;
  }
  .hh-cell {
    display: flex; flex-direction: column; gap: 6px;
    padding: 0; border: 0; background: transparent;
    cursor: pointer; text-align: left;
    transition: transform .16s ease;
  }
  .hh-cell-art {
    position: relative;
    aspect-ratio: 3 / 4;
    border-radius: 10px;
    overflow: hidden;
    background: #161a24;
    border: 2px solid transparent;
    box-shadow: 0 4px 14px rgb(0 0 0 / .4);
    transition: border-color .16s ease, box-shadow .16s ease;
  }
  .hh-cell-art img { width: 100%; height: 100%; object-fit: cover; }
  .hh-cell.focused { transform: scale(1.07); z-index: 2; }
  .hh-cell.focused .hh-cell-art {
    border-color: var(--accent, #ff4d5f);
    box-shadow: 0 8px 30px rgb(255 77 95 / .45);
  }
  .hh-cell.launching .hh-cell-art { opacity: .6; }
  .hh-cell-name {
    font-size: .74rem; color: #c6ccd8;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hh-cell.focused .hh-cell-name { color: #fff; font-weight: 650; }
  .hh-cell-placeholder {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 100%;
    font-size: 1.6rem; font-weight: 800; color: #2e3646;
    background: linear-gradient(135deg, #161a24, #1d2330);
  }
  .hh-cell-placeholder.big { font-size: 3rem; }
  .hh-cell-fav {
    position: absolute; top: 6px; right: 6px;
    color: #ffd34d; text-shadow: 0 1px 6px rgb(0 0 0 / .8);
    font-size: .9rem;
  }

  .hh-detail {
    min-height: 0;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px;
    padding: 18px;
    border-radius: 16px;
    background: rgb(14 17 25 / .82);
    border: 1px solid rgb(255 255 255 / .08);
    backdrop-filter: blur(12px);
  }
  .hh-detail-cover {
    aspect-ratio: 3 / 4;
    max-height: 40%;
    border-radius: 12px; overflow: hidden;
    background: #161a24;
    align-self: center;
    min-width: 160px;
  }
  .hh-detail-cover img { width: 100%; height: 100%; object-fit: cover; }
  .hh-detail-title { margin: 0; font-size: 1.25rem; font-weight: 750; letter-spacing: -.01em; }
  .hh-detail-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .hh-chip {
    padding: 4px 10px; border-radius: 99px;
    background: rgb(255 77 95 / .16); color: var(--accent, #ff4d5f);
    font: 700 .68rem/1 var(--font-mono, monospace);
  }
  .hh-meta-item { font-size: .75rem; color: #9aa3b2; }
  .hh-detail-desc {
    margin: 0; font-size: .8rem; line-height: 1.6; color: #aab2c0;
    display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
  }
  .hh-detail-actions { display: flex; gap: 10px; margin-top: auto; }

  .hh-cta {
    flex: 1;
    padding: 12px 16px;
    border: 0; border-radius: 12px;
    background: var(--accent, #ff4d5f); color: #fff;
    font: 700 .88rem/1 var(--font-ui, system-ui);
    cursor: pointer;
  }
  .hh-cta:disabled { opacity: .6; }
  .hh-cta.secondary {
    background: rgb(255 255 255 / .07);
    border: 1px solid rgb(255 255 255 / .14);
    color: #dfe4ec;
  }

  .hh-hints {
    position: relative; z-index: 1;
    display: flex; gap: 22px; justify-content: center;
    padding: 9px 16px calc(9px + env(safe-area-inset-bottom));
    font-size: .72rem; color: #828b9b;
  }
  .hh-hints b { color: #c6ccd8; font-family: var(--font-mono, monospace); margin-right: 4px; }

  .hh-empty {
    position: relative; z-index: 1;
    flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; text-align: center; padding: 40px;
  }
  .hh-empty h1 { margin: 0; font-size: 1.6rem; }
  .hh-empty p { margin: 0; max-width: 460px; color: #9aa3b2; line-height: 1.7; font-size: .88rem; }
  .hh-empty-actions { display: flex; gap: 12px; margin-top: 8px; }
  .hh-empty-actions .hh-cta { flex: 0 0 auto; padding: 13px 26px; }

  /* 竖屏手机回退：详情面板压到网格下方 */
  @media (orientation: portrait) {
    .hh-main { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
    .hh-detail { flex-direction: row; align-items: center; max-height: 30%; }
    .hh-detail-cover { min-width: 84px; max-height: 100%; }
    .hh-detail-actions { margin-top: 0; flex-direction: column; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hh-cell, .hh-system { transition: none; }
  }
</style>
