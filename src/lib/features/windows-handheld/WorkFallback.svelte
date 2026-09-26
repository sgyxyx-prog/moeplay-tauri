<script lang="ts">
  type Kind = "game" | "anime" | "comic" | "novel" | "book" | "album";
  let { title, kind }: { title: string; kind: Kind } = $props();
  const labels: Record<Kind, string> = { game: "GAME", anime: "ANIME", comic: "MANGA", novel: "NOVEL", book: "BOOK", album: "COLLECTION" };
  const mark = $derived(Array.from(title.trim()).slice(0, 2).join("") || "作品");
</script>

<span class="work-fallback" data-kind={kind} aria-hidden="true">
  <span class="orb"></span>
  <span class="fallback-label">{labels[kind]}</span>
  <strong>{mark}</strong>
  <span class="fallback-line"></span>
</span>

<style>
  .work-fallback {position:relative;isolation:isolate;container-type:inline-size;width:100%;height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;box-sizing:border-box;overflow:hidden;padding:12%;background:linear-gradient(145deg,#1a2442,#3e4b77 58%,#ab96bd);color:#fff;text-align:left;}
  .work-fallback[data-kind="anime"] {background:linear-gradient(145deg,#15294d,#5367a3 58%,#e5b7c4);}
  .work-fallback[data-kind="comic"] {background:linear-gradient(145deg,#172d45,#337b8b 58%,#b9d6c6);}
  .work-fallback[data-kind="novel"],.work-fallback[data-kind="book"] {background:linear-gradient(145deg,#322a49,#8d6382 58%,#dbc2a6);}
  .work-fallback[data-kind="album"] {background:linear-gradient(145deg,#1c2846,#645684 58%,#bdb7d8);}
  .orb {position:absolute;z-index:-1;width:95%;aspect-ratio:1;right:-34%;top:-20%;border:1px solid #ffffff85;border-radius:50%;box-shadow:0 0 0 18px #ffffff16,0 0 0 38px #ffffff13;transform:rotate(-20deg);}
  .fallback-label {font-size:clamp(9px,.85vw,13px);font-weight:800;letter-spacing:.22em;opacity:.85;}
  strong {max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(17px,34cqw,76px);font-weight:760;letter-spacing:-.12em;line-height:1;}
  .fallback-line {width:35%;height:3px;background:#ffffffd6;border-radius:9px;}
</style>
