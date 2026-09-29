<script lang="ts">
  import Icon from "../../components/Icon.svelte";
  type Kind = "game" | "anime" | "comic" | "novel" | "book" | "album";
  let { title, kind }: { title: string; kind: Kind } = $props();
  const labels: Record<Kind, string> = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说", book: "书籍", album: "专题" };
  const icons: Record<Kind, string> = { game: "gamepad", anime: "film", comic: "image", novel: "book", book: "book", album: "collection" };
</script>

<span class="work-fallback" data-kind={kind} title={title} aria-hidden="true">
  <span class="orb"></span>
  <span class="fallback-label">{labels[kind]}</span>
  <span class="fallback-emblem"><Icon name={icons[kind]} size={42} stroke={1.15} /></span>
  <span class="fallback-line"></span>
</span>

<style>
  .work-fallback {position:relative;isolation:isolate;width:100%;height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;box-sizing:border-box;overflow:hidden;padding:12%;background:linear-gradient(145deg,#1a2442,#3e4b77 58%,#ab96bd);color:#fff;text-align:left;}
  .work-fallback[data-kind="anime"] {background:linear-gradient(145deg,#15294d,#5367a3 58%,#e5b7c4);}
  .work-fallback[data-kind="comic"] {background:linear-gradient(145deg,#172d45,#337b8b 58%,#b9d6c6);}
  .work-fallback[data-kind="novel"],.work-fallback[data-kind="book"] {background:linear-gradient(145deg,#322a49,#8d6382 58%,#dbc2a6);}
  .work-fallback[data-kind="album"] {background:linear-gradient(145deg,#1c2846,#645684 58%,#bdb7d8);}
  .orb {position:absolute;z-index:-1;width:95%;aspect-ratio:1;right:-34%;top:-20%;border:1px solid #ffffff85;border-radius:50%;box-shadow:0 0 0 18px #ffffff16,0 0 0 38px #ffffff13;transform:rotate(-20deg);}
  .fallback-label {font-size:clamp(11px,.9vw,15px);font-weight:760;letter-spacing:.18em;opacity:.9;}
  .fallback-emblem {align-self:center;width:92px;max-width:50%;aspect-ratio:1;display:grid;place-items:center;border:1px solid #ffffff76;border-radius:50%;background:#ffffff15;box-shadow:0 0 0 17px #ffffff0d;color:#ffffffeb;}
  .fallback-line {width:26%;height:2px;background:#ffffffd6;border-radius:9px;}
</style>
