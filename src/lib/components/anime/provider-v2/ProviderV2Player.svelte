<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import Hls from "hls.js";
  import { onMount } from "svelte";
  import { displayProfile } from "../../../features/windows-handheld/profile.svelte";
  import { mediaSurface, createMediaPauseGuard } from "../../../features/windows-handheld/mediaSession";
  import { closeTopOverlay } from "../../../stores/router.svelte";
  import { releaseVideo, watchVideoProgress } from "../../../player/videoProgress";
  import type { AnimeEpisode, AnimeResolveResponse } from "../../../features/anime";
  import Icon from "../../Icon.svelte";
  import { AsyncState } from "../../ui-v2";
  import { focusTrap } from "../../../actions/a11y/focusTrap";
  import { AnimePlaybackShell } from "../playback";

  let {
    resolution,
    episode,
    seriesTitle,
    openingFallback = false,
    onClose,
    onFallback,
  }: {
    resolution: AnimeResolveResponse;
    episode: AnimeEpisode;
    seriesTitle: string;
    openingFallback?: boolean;
    onClose: () => void;
    onFallback: () => void | Promise<void>;
  } = $props();

  let videoElement = $state<HTMLVideoElement | null>(null);
  let playbackError = $state("");
  let mediaAspectRatio = $state(16 / 9);
  let hls: Hls | null = null;
  let frameWatch: ReturnType<typeof watchVideoProgress> | null = null;
  let settingsOpen = $state(false);
  let resumeSeconds = 0;
  let activeEpisodeKey = "";
  const pauseGuard = createMediaPauseGuard(() => videoElement, () => displayProfile.enabled);
  onMount(() => pauseGuard.mount());

  function togglePlayback() {
    if (!videoElement) return;
    pauseGuard.allowPlayback();
    if (videoElement.paused) void videoElement.play().catch(() => undefined);
    else videoElement.pause();
  }
  function seek(delta: number) {
    if (videoElement) videoElement.currentTime = Math.max(0, Math.min(videoElement.duration || Infinity, videoElement.currentTime + delta));
  }

  const target = $derived(resolution.target);
  const canPlayInternally = $derived(target.mode === "native_hls" || target.mode === "native_file");
  const sourceLabel = $derived(`Provider v2 · ${episode.identity.providerId}`);
  const episodePosition = $derived(episode.number === null ? "" : `EP ${String(episode.number).padStart(2, "0")}`);
  const statusTitle = $derived.by(() => {
    if (target.mode === "webview") return "需要安全网页窗口";
    if (target.mode === "external") return "需要交给外部浏览器";
    if (target.mode === "unsupported") return "当前播放方式不受支持";
    return "播放器准备中";
  });
  const statusMessage = $derived.by(() => {
    if (target.mode === "webview") return "该来源依赖网页环境。MoePlay 会重新向后端确认地址和允许域名后再打开独立窗口。";
    if (target.mode === "external") return target.reason || "该来源需要在系统浏览器中继续。";
    if (target.mode === "unsupported") return target.reason;
    return "正在准备媒体。";
  });

  function destroyPlayback() {
    if (videoElement && videoElement.currentTime > 0) resumeSeconds = videoElement.currentTime;
    frameWatch?.dispose();
    frameWatch = null;
    hls?.destroy();
    hls = null;
    if (videoElement) {
      releaseVideo(videoElement);
    }
  }

  function updateMediaRatio() {
    if (videoElement && resumeSeconds > 0 && Number.isFinite(videoElement.duration)) videoElement.currentTime = Math.min(resumeSeconds, videoElement.duration);
    if (!videoElement?.videoWidth || !videoElement.videoHeight) return;
    mediaAspectRatio = videoElement.videoWidth / videoElement.videoHeight;
  }

  function failPlayback(message: string) {
    destroyPlayback();
    playbackError = message;
  }

  function attachPlayback() {
    destroyPlayback();
    const key = `${episode.identity.providerId}:${episode.identity.seriesId}:${episode.identity.episodeId}`;
    if (activeEpisodeKey !== key) {
      resumeSeconds = 0;
      activeEpisodeKey = key;
    }
    playbackError = "";
    mediaAspectRatio = 16 / 9;
    if (!videoElement) return;
    if (canPlayInternally) frameWatch = watchVideoProgress(videoElement, failPlayback);
    if (target.mode === "native_file") {
      videoElement.src = convertFileSrc(target.path);
      void videoElement.play().catch(() => undefined);
      return;
    }
    if (target.mode !== "native_hls") return;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) failPlayback("视频流无法继续播放，请重试或返回剧集切换来源。");
      });
      hls.loadSource(target.url);
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoElement?.play().catch(() => undefined);
      });
    } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      videoElement.src = target.url;
      void videoElement.play().catch(() => undefined);
    } else {
      failPlayback("当前系统 WebView 不支持 HLS 播放。");
    }
  }

  function handleVideoError() {
    failPlayback(target.mode === "native_file"
      ? "该文件的封装或编码不受内置播放器支持，可尝试系统播放器。"
      : "视频加载失败，请检查来源状态后重试。");
  }

  $effect(() => {
    if (!videoElement || !canPlayInternally) return;
    attachPlayback();
    return destroyPlayback;
  });
</script>

<div
  class="player-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="provider-player-title"
  aria-describedby="provider-player-description"
  tabindex="-1"
  use:focusTrap={{ initialFocus: '[data-provider-player-close]', returnFocus: true, closeOnEscape: true, onEscape: () => { if (displayProfile.enabled) closeTopOverlay(); else onClose(); } }}
  use:mediaSurface={{ enabled: displayProfile.enabled, id: "windows-provider-player", onBack: onClose, handlers: playbackError || !canPlayInternally ? {} : {
    launch: togglePlayback, left: () => seek(-10), right: () => seek(10),
    favorite: onClose, activate: () => { settingsOpen = !settingsOpen; },
  } }}
>
  <span class="sr-only" id="provider-player-title">{seriesTitle}</span>
  <span class="sr-only" id="provider-player-description">{episode.title}</span>

  <AnimePlaybackShell
    title={seriesTitle}
    episodeTitle={episode.title}
    artworkUrl={episode.artworkUrl}
    {sourceLabel}
    {episodePosition}
    aspectRatio={mediaAspectRatio}
    variant="provider"
    stageLabel={`${seriesTitle} ${episode.title} 播放区域`}
  >
    {#snippet headerActions()}
      {#if displayProfile.enabled && canPlayInternally}
        <button type="button" class="icon-button" aria-label="播放设置" onclick={() => { settingsOpen = !settingsOpen; }}><Icon name="settings" size={18} /></button>
      {/if}
      <button class="icon-button" data-provider-player-close type="button" aria-label="关闭播放器并返回剧集" onclick={onClose}>
        <Icon name="x" size={18} />
      </button>
    {/snippet}

    {#snippet media()}
      <div class="player-stage" class:handoff={!canPlayInternally}>
        {#if canPlayInternally}
          <video
            bind:this={videoElement}
            controls
            autoplay
            playsinline
            preload="metadata"
            onloadedmetadata={updateMediaRatio}
            onplay={() => pauseGuard.acceptPlay()}
            onpointerdown={() => pauseGuard.allowPlayback()}
            onerror={handleVideoError}
            aria-label={`${seriesTitle} ${episode.title}`}
          ></video>
          {#if playbackError}
            <div class="playback-notice" role="alert">
              <Icon name="info" size={18} />
              <span>{playbackError}</span>
              <button type="button" onclick={attachPlayback}>重试</button>
              <button type="button" onclick={onClose}>返回剧集换源</button>
              {#if target.mode === "native_file"}
                <button type="button" onclick={onFallback} disabled={openingFallback}>
                  {openingFallback ? "正在打开" : "使用系统播放器"}
                </button>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="handoff-card">
            <AsyncState
              state={target.mode === "unsupported" ? "error" : openingFallback ? "loading" : "partial"}
              title={statusTitle}
              description={statusMessage}
              loadingDelayMs={0}
              primaryAction={target.mode === "webview" || target.mode === "external" ? {
                label: openingFallback ? "正在确认" : target.mode === "webview" ? "打开安全窗口" : "在浏览器中打开",
                onSelect: () => void onFallback(),
                disabled: openingFallback,
                loading: openingFallback,
              } : undefined}
            />
          </div>
        {/if}
      </div>
    {/snippet}
  </AnimePlaybackShell>
  {#if displayProfile.enabled && settingsOpen}
    <aside class="windows-playback-settings" aria-label="播放设置" use:mediaSurface={{ enabled: true, id: "windows-provider-settings", menu: true, onBack: () => { settingsOpen = false; } }}>
      <button type="button" onclick={() => { settingsOpen = false; }}>返回播放</button>
      <button type="button" onclick={togglePlayback}>播放 / 暂停</button>
      <button type="button" onclick={() => seek(-10)}>后退 10 秒</button>
      <button type="button" onclick={() => seek(10)}>前进 10 秒</button>
      <label>音量 <input type="range" aria-label="音量" min="0" max="1" step="0.1" value={videoElement?.volume ?? 1} oninput={event => { if (videoElement) videoElement.volume = Number(event.currentTarget.value); }} /></label>
      <label>倍速 <select aria-label="倍速" value={String(videoElement?.playbackRate ?? 1)} onchange={event => { if (videoElement) videoElement.playbackRate = Number(event.currentTarget.value); }}><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label>
    </aside>
  {/if}
</div>

<style>
  .windows-playback-settings { position: absolute; z-index: 2; top: 70px; right: 20px; bottom: 20px; width: min(380px, 42vw); display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #121722; overflow: auto; border: 1px solid #ffffff38; }
  .windows-playback-settings :is(button,select) { min-height: 48px; color: inherit; background: #202938; border: 1px solid #ffffff38; font-size: 16px; }
  .windows-playback-settings label { display: grid; gap: 8px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .player-backdrop {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(4, 6, 12, 0.88);
    backdrop-filter: blur(16px);
  }
  .icon-button {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 9px;
    background: rgba(255,255,255,0.04);
    color: #cbd0da;
    cursor: pointer;
  }
  .icon-button:hover { background: rgba(255,255,255,0.09); color: white; }
  .player-stage {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #000;
  }
  .player-stage.handoff { padding: clamp(20px, 5vw, 48px); }
  video { width: 100%; height: 100%; object-fit: contain; background: transparent; }
  .playback-notice {
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 13px;
    border: 1px solid rgba(248,113,113,0.28);
    border-radius: 10px;
    background: rgba(23,9,12,0.92);
    color: #f5c2c7;
    font-size: 12px;
  }
  .playback-notice span { flex: 1; }
  .playback-notice button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 7px 10px;
    border: 0;
    border-radius: 9px;
    background: #58ad98;
    color: #06110e;
    font: inherit;
    font-size: 11px;
    font-weight: 750;
    cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: wait; }
  .handoff-card {
    width: min(620px, 100%);
    display: grid;
    gap: 18px;
    padding: 28px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    background: rgba(255,255,255,0.035);
  }
  @media (max-width: 700px) {
    .player-backdrop { padding: 0; }
    .handoff-card { padding: 20px; }
    .windows-playback-settings { inset: 0; width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .player-backdrop, .player-backdrop * { animation: none !important; transition: none !important; }
  }
  :global([data-motion="reduce"]) .player-backdrop,
  :global([data-motion="reduce"]) .player-backdrop * { animation: none !important; transition: none !important; }
</style>
