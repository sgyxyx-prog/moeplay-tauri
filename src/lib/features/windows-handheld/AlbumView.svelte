<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invokeCmd } from "../../api/core";
  import { Drawer } from "../../components/ui-v2";
  import Icon from "../../components/Icon.svelte";
  import { attachGamepad } from "../../components/switch/useGamepad.svelte";
  import { moveGamepadFocus, activateGamepadFocus } from "../../actions/a11y/domGamepadNavigation";
  import { closeOverlay, closeTopOverlay, openOverlay, routerStore } from "../../stores/router.svelte";
  import { showSystemKeyboard } from "./native";
  import VirtualList from "./VirtualList.svelte";
  import { catalogStore, memberOf, relationMember, type AlbumMember, type WorkRelation } from "./catalog.svelte";
  import type { HandheldContentItem } from "./types";

  let { items, activeAlbumId, activeMemberId, onalbum, onmember, onselect, onopen, onsearch }:
    { items: HandheldContentItem[]; activeAlbumId: string | null; activeMemberId: string | null; onalbum: (id: string | null) => void; onmember: (id: string | null) => void;
      onselect: (item: HandheldContentItem | null) => void; onopen: (item: HandheldContentItem) => void;
      onsearch: (title: string, kind: AlbumMember["kind"]) => void } = $props();

  const album = $derived(catalogStore.albums.find(entry => entry.id === activeAlbumId) ?? null);
  const localItems = $derived(new Map(items.map(item => [item.id, item])));
  const selectedMember = $derived(album?.members.find(member => member.id === selectedMemberId) ?? album?.members[0] ?? null);
  let selectedMemberId = $state<string | null>(null);
  $effect(() => { selectedMemberId = activeMemberId; });
  let newTitle = $state("");
  let addQuery = $state("");
  let relationQuery = $state("");
  let relationResults = $state<{ subjectId: number; title: string; subjectType: number; cover: string | null }[]>([]);
  let relationBusy = $state(false);
  let relations = $state<WorkRelation[]>([]);
  let relatedFor = $state<number | null>(null);
  let relationError = $state("");
  let linkSubject = $state<WorkRelation | null>(null);
  let linkQuery = $state("");
  let imageInput = $state<HTMLInputElement>();
  let confirmDelete = $state(false);
  let draggedMemberId = $state<string | null>(null);
  let dropMemberId = $state<string | null>(null);
  let panel = $state<"edit" | "member" | "relations" | null>(null);
  let panelRoot = $state<HTMLElement>();
  let panelReturn: HTMLElement | null = null;
  let failedImages = $state<string[]>([]);
  const albumOverlayId = "handheld-album-panel";
  const kindLabels: Record<AlbumMember["kind"], string> = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说", book: "书籍" };
  const collage = (members: AlbumMember[]) => members.map(member => member.cover).filter((src): src is string => typeof src === "string" && src.length > 0 && !failedImages.includes(src)).slice(0, 3);
  function imageFailed(src: string) { if (!failedImages.includes(src)) failedImages = [...failedImages, src]; }
  function dismissAlbumPanel() {
    if (!panel) return;
    panel = null;
    if (routerStore.topOverlay?.id === albumOverlayId) closeOverlay(albumOverlayId);
    void tick().then(() => { if (panelReturn?.isConnected) panelReturn.focus({ preventScroll: true }); });
  }
  function openAlbumPanel(next: "edit" | "member" | "relations") {
    if (!panel) {
      panelReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openOverlay({ id: albumOverlayId, kind: "drawer", returnFocusKey: selectedMemberId }, dismissAlbumPanel);
    }
    panel = next;
    if (next === "relations" && selectedMember && (selectedMember.bangumiId || (selectedMember.contentId && catalogStore.getBinding(selectedMember.contentId)))) void loadRelations();
  }
  let notifiedMemberId: string | null = null;
  const filteredLocal = $derived(items.filter(item => item.title.toLocaleLowerCase().includes(addQuery.toLocaleLowerCase())).slice(0, 10_000));
  const linkItems = $derived(items.filter(item => item.title.toLocaleLowerCase().includes(linkQuery.toLocaleLowerCase())).slice(0, 10_000));

  let albumScope: ReturnType<typeof attachGamepad> | undefined;
  $effect(() => {
    const enabled = panel !== null && routerStore.topOverlay?.id === albumOverlayId;
    albumScope?.setEnabled(enabled);
  });
  onMount(() => {
    void catalogStore.load();
    albumScope = attachGamepad({
      up: () => moveGamepadFocus("up", { root: panelRoot }),
      down: () => moveGamepadFocus("down", { root: panelRoot }),
      left: () => moveGamepadFocus("left", { root: panelRoot }),
      right: () => moveGamepadFocus("right", { root: panelRoot }),
      launch: () => activateGamepadFocus({ root: panelRoot }),
      back: () => closeTopOverlay(),
    }, { id: albumOverlayId, priority: 220, overlay: true, enabled: false });
    return () => { albumScope?.(); if (panel) closeOverlay(albumOverlayId); };
  });
  $effect(() => {
    const member = selectedMember;
    if (member?.id === notifiedMemberId) return;
    notifiedMemberId = member?.id ?? null;
    const item = member?.contentId ? localItems.get(member.contentId) : undefined;
    onselect(item ?? null);
  });

  async function create() {
    if (!newTitle.trim()) return;
    try { const id = await catalogStore.create(newTitle.trim()); newTitle = ""; onalbum(id); }
    catch (error) { relationError = String(error); }
  }
  async function add(item: HandheldContentItem) {
    if (!album) return;
    try { await catalogStore.addMember(album.id, memberOf(item)); selectedMemberId = item.id; onmember(item.id); onselect(item); dismissAlbumPanel(); }
    catch (error) { relationError = String(error); }
  }
  async function uploadCover(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !album) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) { relationError = "封面仅支持 4 MB 内的 PNG、JPEG 或 WebP。"; return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string" && album) void catalogStore.editAlbum(album.id, { cover: reader.result }).catch(error => relationError = String(error)); };
    reader.onerror = () => { relationError = "封面读取失败"; };
    reader.readAsDataURL(file);
  }
  async function searchBangumi() {
    if (!relationQuery.trim()) return;
    relationBusy = true; relationError = "";
    try { relationResults = await invokeCmd("handheld_bangumi_search", { keyword: relationQuery.trim() }); }
    catch (error) { relationError = `Bangumi 搜索失败：${String(error)}`; }
    finally { relationBusy = false; }
  }
  async function bindMember(subjectId: number, subjectType: number) {
    if (!selectedMember?.contentId) return;
    const compatible = subjectType === 1 ? selectedMember.kind === "comic" || selectedMember.kind === "novel"
      : subjectType === 2 ? selectedMember.kind === "anime" : subjectType === 4 && selectedMember.kind === "game";
    if (!compatible) { relationError = "条目类型与当前内容不一致。书籍条目需由你确认对应漫画或小说。"; return; }
    try {
      await catalogStore.bind(selectedMember.contentId, subjectId);
      if (album) await catalogStore.editMember(album.id, selectedMember.id, { kind: selectedMember.kind });
      relationResults = []; relationQuery = "";
      await loadRelations(subjectId);
    } catch (error) { relationError = String(error); }
  }
  async function loadRelations(subjectId?: number) {
    const id = subjectId ?? selectedMember?.bangumiId ?? (selectedMember?.contentId ? catalogStore.getBinding(selectedMember.contentId) : null);
    if (!id) { relationError = "请先为当前作品确认 Bangumi 条目。"; return; }
    relationBusy = true; relationError = ""; relatedFor = id;
    try { const result = await catalogStore.relations(id); if (relatedFor === id) relations = result; }
    catch (error) { if (relatedFor === id) relationError = `关联查询失败：${String(error)}`; }
    finally { relationBusy = false; }
  }
  async function addRelation(relation: WorkRelation) {
    if (!album) return;
    try {
      const matches = catalogStore.catalog.bindings.filter(binding => binding.bangumiId === relation.subjectId)
        .map(binding => localItems.get(binding.contentId)).filter((item): item is HandheldContentItem => Boolean(item));
      const member = matches.length === 1 ? { ...memberOf(matches[0]), bangumiId: relation.subjectId, relation: relation.relation } : relationMember(relation);
      await catalogStore.addMember(album.id, member);
      selectedMemberId = member.id; onmember(member.id);
    } catch (error) { relationError = String(error); }
  }
  async function link(item: HandheldContentItem) {
    if (!album || !linkSubject) return;
    const compatible = linkSubject.subjectType === 1 ? item.kind === "comic" || item.kind === "novel"
      : linkSubject.subjectType === 2 ? item.kind === "anime" : linkSubject.subjectType === 4 && item.kind === "game";
    if (!compatible) { relationError = "作品类型不匹配，请选择对应的游戏、番剧、漫画或小说。"; return; }
    try {
      if (selectedMember && !selectedMember.contentId && selectedMember.bangumiId === linkSubject.subjectId)
        await catalogStore.linkMember(album.id, selectedMember.id, item, linkSubject.subjectId);
      else {
        await catalogStore.bind(item.id, linkSubject.subjectId);
        await catalogStore.addMember(album.id, { ...memberOf(item), bangumiId: linkSubject.subjectId, relation: linkSubject.relation });
      }
      linkSubject = null; linkQuery = ""; selectedMemberId = item.id; onmember(item.id); onselect(item);
    } catch (error) { relationError = String(error); }
  }
  function selectMember(member: AlbumMember) {
    selectedMemberId = member.id;
    onmember(member.id);
    const item = member.contentId ? localItems.get(member.contentId) : undefined;
    onselect(item ?? null);
    relations = []; relatedFor = null; relationResults = []; relationError = "";
  }
  function dragAt(event: PointerEvent) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-album-member]");
    dropMemberId = target?.dataset.albumMember ?? null;
  }
  function startTouchReorder(event: PointerEvent, memberId: string) {
    if (event.pointerType === "mouse" || !(event.target instanceof Element) || !event.target.closest(".chapter-index")) return;
    event.preventDefault();
    draggedMemberId = memberId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function finishTouchReorder(event: PointerEvent) {
    if (!draggedMemberId) return;
    dragAt(event);
    if (album && dropMemberId) void catalogStore.reorderMember(album.id, draggedMemberId, dropMemberId);
    draggedMemberId = null; dropMemberId = null;
  }
</script>

{#if !album}
  <section class="album-index" aria-label="我的专题">
    <div class="album-lead"><div><span class="eyebrow">个人收藏</span><h2>我的专题</h2><p>把喜欢的游戏、番剧、漫画和小说放在一起。</p></div><span class="album-count">{catalogStore.albums.length} 个专题</span></div>
    <form class="create-line" onsubmit={event => { event.preventDefault(); void create(); }}>
      <label><span class="sr-only">新专题名称</span><input bind:value={newTitle} placeholder="给新专题起个名字" maxlength="80" /></label>
      <button type="button" onclick={() => void showSystemKeyboard()}>打开键盘</button><button class="accent" type="submit" disabled={!newTitle.trim()}><Icon name="plus" size={18} />创建专题</button>
    </form>
    {#if catalogStore.error}<p role="status">专题加载失败：{catalogStore.error}</p>{/if}
    {#if relationError}<p role="status">{relationError}</p>{/if}
    {#if !catalogStore.albums.length}<div class="empty"><Icon name="collection" size={48} stroke={1.1} /><h3>从第一本专题开始</h3><p>专题可以收藏一个系列，也可以收集你想接着体验的故事。</p></div>{/if}
    <div class="album-grid">
      {#each catalogStore.albums as entry (entry.id)}
        <button class="album-tile" onclick={() => { onalbum(entry.id); selectedMemberId = null; confirmDelete = false; }}>
          <span class="tile-art">
            {#if entry.cover && !failedImages.includes(entry.cover)}
              <img src={entry.cover} alt="" loading="lazy" style:object-position={entry.focalX * 100 + "% " + entry.focalY * 100 + "%"} onerror={() => imageFailed(entry.cover!)} />
            {:else if collage(entry.members).length}
              <span class="collage">{#each collage(entry.members) as src}<img src={src} alt="" loading="lazy" onerror={() => imageFailed(src)} />{/each}</span>
            {:else}<Icon name="collection" size={62} stroke={1} />{/if}
          </span>
          <span class="tile-copy"><small>{entry.pinned ? "已置顶 · " : ""}{entry.members.length} 部作品</small><strong>{entry.title}</strong><em>{entry.description || "打开专题"}</em></span>
        </button>
      {/each}
    </div>
  </section>
{:else}
  <section class="album-detail" aria-label={ "专题 " + album.title }>
    <div class="album-cover">
      {#if album.cover && !failedImages.includes(album.cover)}
        <img class="cover-image" src={album.cover} alt="" style:object-position={album.focalX * 100 + "% " + album.focalY * 100 + "%"} onerror={() => imageFailed(album.cover!)} />
      {:else if collage(album.members).length}
        <div class="cover-collage">{#each collage(album.members) as src}<img src={src} alt="" onerror={() => imageFailed(src)} />{/each}</div>
      {:else}<div class="cover-fallback"><Icon name="collection" size={100} stroke={.8} /></div>{/if}
      <div class="cover-wash"></div>
      <div class="cover-content"><button class="back-link" onclick={() => { onalbum(null); selectedMemberId = null; confirmDelete = false; }}><Icon name="arrowLeft" size={17} />我的专题</button><span class="eyebrow">{album.members.length} 部作品</span><h2>{album.title}</h2><p>{album.description || "把喜欢的作品编成自己的故事。"} </p></div>
      <button class="edit-cover" onclick={() => openAlbumPanel("edit")}><Icon name="gear" size={18} />编辑专题</button>
    </div>
    <div class="album-main">
      <div class="section-title"><h3>作品目录</h3><button onclick={() => openAlbumPanel("edit")}><Icon name="plus" size={18} />添加作品</button></div>
      {#if album.members.length}
        <div class="member-list"><VirtualList items={album.members} itemKey={member => member.id} estimateSize={128} focusId={selectedMember?.id} label="专题作品目录" onselect={selectMember}>
          {#snippet children(member, index)}
            <button class="member" class:selected={selectedMember?.id === member.id} class:drop-target={dropMemberId === member.id} data-album-member={member.id} draggable="true"
              ondragstart={event => { draggedMemberId = member.id; event.dataTransfer?.setData("text/plain", member.id); }}
              ondragover={event => { event.preventDefault(); dropMemberId = member.id; }}
              ondrop={event => { event.preventDefault(); const from = event.dataTransfer?.getData("text/plain") || draggedMemberId; if (album && from) void catalogStore.reorderMember(album.id, from, member.id); draggedMemberId = null; dropMemberId = null; }}
              ondragend={() => { draggedMemberId = null; dropMemberId = null; }}
              onpointerdown={event => startTouchReorder(event, member.id)} onpointermove={event => { if (draggedMemberId) dragAt(event); }}
              onpointerup={finishTouchReorder} onpointercancel={() => { draggedMemberId = null; dropMemberId = null; }}
              onclick={() => selectMember(member)} ondblclick={() => { const item = member.contentId ? localItems.get(member.contentId) : undefined; if (item) onopen(item); }}>
              <span class="chapter-index" title="触屏按住拖动排序">{index + 1}</span>
              <span class="member-art">{#if member.cover && !failedImages.includes(member.cover)}<img src={member.cover} alt="" loading="lazy" onerror={() => imageFailed(member.cover!)} />{:else}<Icon name="book" size={34} />{/if}</span>
              <span class="member-copy"><small>{member.group || member.relation || "收录作品"} · {kindLabels[member.kind]}</small><strong>{member.title}</strong><em>{member.contentId && localItems.get(member.contentId) ? localItems.get(member.contentId)?.progressLabel : "仅资料 · 尚未绑定可用内容"}</em>{#if member.note}<span class="member-note">“{member.note}”</span>{/if}</span>
              <Icon name="arrowRight" size={18} />
            </button>
          {/snippet}
        </VirtualList></div>
      {:else}<div class="empty"><Icon name="plus" size={36} /><h3>专题尚未收录作品</h3><p>从本机内容添加作品，或从作品操作加入。</p></div>{/if}
      {#if selectedMember}
        <div class="selected-actions"><span>当前：<strong>{selectedMember.title}</strong></span>
          {#if selectedMember.contentId && localItems.get(selectedMember.contentId)}<button class="accent" onclick={() => onopen(localItems.get(selectedMember.contentId!)!)}>继续使用</button>
          {:else}<button onclick={() => onsearch(selectedMember.title, selectedMember.kind)}>查找来源</button>{/if}
          <button onclick={() => openAlbumPanel("member")}>编辑这项</button><button onclick={() => openAlbumPanel("relations")}>查看关联</button>
        </div>
      {/if}
    </div>
  </section>
{/if}

<Drawer open={panel !== null && album !== null} title={panel === "edit" ? "编辑专题" : panel === "member" ? "编排作品" : "关联作品"} onClose={dismissAlbumPanel} bind:ref={panelRoot} class="album-drawer" returnFocus={false}>
  {#if album}
    <div class="album-panel">
      {#if relationError}<p role="status">{relationError}</p>{/if}
      {#if panel === "edit"}
        <div class="edit-block"><label>专题标题<input value={album.title} maxlength="80" onchange={event => void catalogStore.editAlbum(album.id, { title: event.currentTarget.value.trim() || album.title })} /></label>
          <label>简介<textarea value={album.description} maxlength="600" rows="3" onchange={event => void catalogStore.editAlbum(album.id, { description: event.currentTarget.value })}></textarea></label>
          <button onclick={() => imageInput?.click()}><Icon name="image" size={18} />更换封面</button><input bind:this={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={uploadCover} />
          <label>封面横向位置<input type="range" min="0" max="100" value={album.focalX * 100} onchange={event => void catalogStore.editAlbum(album.id, { focalX: Number(event.currentTarget.value) / 100 })} /></label>
          <label>封面纵向位置<input type="range" min="0" max="100" value={album.focalY * 100} onchange={event => void catalogStore.editAlbum(album.id, { focalY: Number(event.currentTarget.value) / 100 })} /></label>
          <button onclick={() => void catalogStore.editAlbum(album.id, { pinned: !album.pinned })}>{album.pinned ? "取消置顶" : "置顶专题"}</button>
        </div>
        <div class="add-search"><h3>添加本机作品</h3><input bind:value={addQuery} placeholder="搜索游戏、番剧、漫画或小说" aria-label="搜索本机作品" /><div class="add-results"><VirtualList items={filteredLocal} itemKey={item => item.id} estimateSize={62} label="可添加作品">{#snippet children(item)}<button class="pick-result" onclick={() => void add(item)}><span>{kindLabels[item.kind]}</span><strong>{item.title}</strong><small>{item.progressLabel}</small></button>{/snippet}</VirtualList></div></div>
        <p class="storage-note">专题保存在本机，可通过现有数据库备份导出与导入。</p>
        <div class="delete-tools">{#if confirmDelete}<span>只删除专题编排，作品与历史保留。</span><button onclick={() => confirmDelete = false}>取消</button><button class="danger" onclick={() => void catalogStore.removeAlbum(album.id).then(() => { confirmDelete = false; dismissAlbumPanel(); onalbum(null); }).catch(error => relationError = String(error))}>确认删除专题</button>{:else}<button onclick={() => confirmDelete = true}>删除专题</button>{/if}</div>
      {:else if panel === "member" && selectedMember}
        <div class="member-tools"><h3>{selectedMember.title}</h3><p>{selectedMember.contentId && localItems.get(selectedMember.contentId) ? localItems.get(selectedMember.contentId)?.progressLabel : "仅资料 · 需要关联本机内容"}</p>
          <label>分组<input value={selectedMember.group} maxlength="40" placeholder="例如：原作篇" onchange={event => void catalogStore.editMember(album.id, selectedMember.id, { group: event.currentTarget.value })} /></label>
          <label>我的短评<textarea value={selectedMember.note} maxlength="300" rows="3" onchange={event => void catalogStore.editMember(album.id, selectedMember.id, { note: event.currentTarget.value })}></textarea></label>
          <div class="small-actions"><button onclick={() => void catalogStore.moveMember(album.id, selectedMember.id, -1)}>向前</button><button onclick={() => void catalogStore.moveMember(album.id, selectedMember.id, 1)}>向后</button><button onclick={() => void catalogStore.removeMember(album.id, selectedMember.id)}>移出专题</button></div>
          <button onclick={() => openAlbumPanel("relations")}>查看 Bangumi 关联</button>
        </div>
      {:else if panel === "relations" && selectedMember}
        <div class="relations"><h3>{selectedMember.title} · 关联作品</h3>
          {#if !selectedMember.contentId && selectedMember.bangumiId}
            <button onclick={() => { linkSubject = { subjectId: selectedMember.bangumiId!, title: selectedMember.title, relation: selectedMember.relation, subjectType: selectedMember.kind === "book" ? 1 : selectedMember.kind === "anime" ? 2 : selectedMember.kind === "game" ? 4 : 0, cover: selectedMember.cover }; linkQuery = selectedMember.title; }}>关联本机内容</button>
          {/if}
          {#if !selectedMember.bangumiId && !(selectedMember.contentId && catalogStore.getBinding(selectedMember.contentId))}
            <div class="bind-box"><label>确认 Bangumi 条目<input bind:value={relationQuery} placeholder="搜索作品标题" /></label><button onclick={() => void searchBangumi()} disabled={relationBusy || !relationQuery.trim()}>搜索条目</button>
              {#each relationResults as result}<button class="candidate" onclick={() => void bindMember(result.subjectId, result.subjectType)}>{result.title}<small>Bangumi #{result.subjectId} · {result.subjectType === 1 ? "书籍（请确认漫画或小说）" : result.subjectType === 2 ? "动画" : "游戏"}</small></button>{/each}
            </div>
          {/if}
          {#if relationBusy}<p>正在查询关联作品…</p>{/if}
          {#each relations.filter(entry => !album.ignoredSubjects.includes(entry.subjectId)) as related}
            <div class="relation"><span>{related.relation} · {related.subjectType === 1 ? "书籍（待确认漫画或小说）" : related.subjectType === 2 ? "动画" : related.subjectType === 4 ? "游戏" : "资料"}</span><strong>{related.title}</strong><div class="small-actions"><button onclick={() => void addRelation(related)}>加入专题</button><button onclick={() => { linkSubject = related; linkQuery = related.title; }}>关联已有内容</button><button onclick={() => void catalogStore.ignore(album.id, related.subjectId)}>忽略</button></div></div>
          {/each}
          {#if linkSubject}<div class="link-box"><h3>关联：{linkSubject.title}</h3><input bind:value={linkQuery} aria-label="搜索本机内容进行关联" /><div class="link-results"><VirtualList items={linkItems} itemKey={item => item.id} estimateSize={56} label="可关联内容">{#snippet children(item)}<button onclick={() => void link(item)}>{item.title}<small>{item.kind}</small></button>{/snippet}</VirtualList></div><button onclick={() => linkSubject = null}>取消</button></div>{/if}
        </div>
      {/if}
    </div>
  {/if}
</Drawer>

<style>
  .album-index,.album-detail {height:100%;min-height:0;overflow:auto;color:#202535;scrollbar-width:thin;}
  .album-detail {display:flex;flex-direction:column;gap:14px;overflow:hidden;}
  h2,h3,p {margin:0;}h2 {font-size:clamp(29px,3vw,46px);line-height:1.12;letter-spacing:-.035em;}h3 {font-size:21px;}.eyebrow {font-size:14px;font-weight:750;color:#6454b4;}
  button {font:inherit;min-height:44px;border:1px solid #d8dae8;border-radius:12px;background:#fff;color:#273047;padding:8px 13px;cursor:pointer;}
  button:hover {background:#f1effb;}button:focus-visible,input:focus-visible,textarea:focus-visible {outline:3px solid #5849b4;outline-offset:2px;}
  .accent {display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--hh-action,#6253b8);color:white;border-color:transparent;font-weight:740;}
  .album-lead {display:flex;justify-content:space-between;align-items:end;gap:20px;margin:12px 0 18px;}.album-lead p {margin-top:8px;color:#687386;}.album-count {color:#6454b4;font-weight:740;white-space:nowrap;}
  .create-line {display:flex;gap:9px;margin-bottom:20px;}.create-line label {flex:1;min-width:0;}
  input,textarea {width:100%;min-height:44px;box-sizing:border-box;border:1px solid #d4d8e6;border-radius:11px;background:#fff;color:#202535;padding:8px 12px;font:inherit;}
  textarea {resize:vertical;}.album-grid {display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,265px),1fr));gap:16px;padding-bottom:20px;}
  .album-tile {display:flex;flex-direction:column;align-items:stretch;overflow:hidden;min-height:265px;padding:0;text-align:left;border:1px solid #dde0eb;border-radius:18px;background:#fff;box-shadow:0 6px 20px #343f6112;}
  .album-tile:focus-visible {border-color:#5e4cbd;}.tile-art {height:178px;display:grid;place-items:center;overflow:hidden;background:linear-gradient(135deg,#e9e4f8,#e8edf8);color:#8877c5;}
  .tile-art>img {width:100%;height:100%;object-fit:cover;}.collage,.cover-collage {width:100%;height:100%;display:flex;overflow:hidden;}.collage img,.cover-collage img {min-width:0;flex:1;height:100%;object-fit:cover;}
  .tile-copy {display:flex;flex-direction:column;gap:3px;padding:11px 14px;min-width:0;}.tile-copy small {font-size:12px;color:#6857bb;font-weight:720;}.tile-copy strong {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;}.tile-copy em {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#70798b;font-size:13px;font-style:normal;}
  .album-cover {position:relative;flex:none;min-height:188px;height:clamp(188px,27vh,310px);display:flex;align-items:end;overflow:hidden;border-radius:22px;background:#e9e7f7;border:1px solid #dce0ed;}
  .cover-image,.cover-collage,.cover-fallback,.cover-wash {position:absolute;inset:0;width:100%;height:100%;}.cover-image {object-fit:cover;}.cover-fallback {display:grid;place-items:center;color:#ada2d5;}
  .cover-wash {background:linear-gradient(90deg,#f9f9ffed 0%,#f9f9ffbd 43%,#f9f9ff18 78%);}
  .cover-content {position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-start;gap:7px;max-width:62%;padding:16px 22px 20px;}
  .cover-content h2 {display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}.cover-content p {max-width:540px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;color:#586275;}
  .back-link {display:flex;align-items:center;gap:5px;min-height:44px;padding:5px 0;border:0;background:transparent;color:#5344a7;font-weight:720;}
  .edit-cover {position:absolute;z-index:2;right:18px;bottom:18px;display:flex;align-items:center;gap:7px;background:#ffffffed;font-weight:720;}
  .album-main {flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;}.section-title {display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 3px;}
  .section-title button {display:flex;align-items:center;gap:5px;}.member-list {flex:1;min-height:125px;}.member-list :global(.wh-virtual-list) {--wh-gap:10px;}
  .member {display:flex;align-items:center;gap:12px;width:100%;height:100%;padding:8px 12px;text-align:left;border:1px solid #dfe1ec;border-radius:15px;background:#fff;}
  .member.selected {border:2px solid var(--hh-action,#6253b8);background:#fbfaff;box-shadow:0 4px 13px #5145921c;}.member.drop-target {outline:3px solid #5849b4;}
  .chapter-index {width:34px;min-width:34px;height:44px;display:grid;place-items:center;color:#7162bb;font-weight:750;touch-action:none;cursor:grab;}
  .member-art {width:75px;height:102px;flex:none;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#eceafb;color:#8374c8;}
  .member-art img {width:100%;height:100%;object-fit:contain;}.member-copy {flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
  .member-copy strong,.member-copy small,.member-copy em,.member-note {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.member-copy strong {font-size:18px;}.member-copy small {color:#6656b5;font-size:13px;}
  .member-copy em {font-size:13px;font-style:normal;color:#647085;}.member-note {font-size:13px;color:#717a8b;}
  .selected-actions {flex:none;display:flex;align-items:center;gap:8px;min-height:54px;padding:7px 10px;border:1px solid #e0e2ed;border-radius:14px;background:#fff;}
  .selected-actions>span {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#687386;}.selected-actions strong {color:#273047;}
  .selected-actions button {white-space:nowrap;}.empty {display:grid;place-items:center;gap:8px;min-height:180px;border:1px dashed #cdd0e2;border-radius:17px;color:#7163b9;text-align:center;}.empty p {color:#667084;}
  .album-panel {display:grid;align-content:start;gap:18px;padding:4px 2px 20px;}.album-panel label {display:grid;gap:6px;color:#4a5267;font-size:14px;font-weight:670;}
  .edit-block,.member-tools,.relations,.bind-box,.link-box {display:grid;align-content:start;gap:12px;}
  .edit-block {padding-bottom:15px;border-bottom:1px solid #dfe1ed;}.edit-block input[type=range] {accent-color:var(--hh-action,#6253b8);}
  .add-search {display:grid;gap:9px;}.add-results,.link-results {height:190px;min-height:0;}.pick-result,.link-results button {display:flex;align-items:center;gap:8px;width:100%;height:100%;text-align:left;}
  .pick-result strong {flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.pick-result small {font-size:12px;color:#657085;}
  .small-actions {display:flex;gap:8px;flex-wrap:wrap;}.storage-note,.member-tools p {font-size:13px;color:#697286;}.delete-tools {display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid #e1e3ee;padding-top:12px;}.danger {border-color:#df9aa6;color:#a83650;}
  .candidate {display:flex;flex-direction:column;align-items:start;text-align:left;}.candidate small {color:#697286;font-size:12px;}.relation {display:grid;gap:7px;padding:12px;border:1px solid #e0e2ed;border-radius:14px;background:#fff;}.relation span {font-size:13px;color:#6555b2;}
  :global(.album-drawer) {background:#fbfbff!important;color:#202535!important;width:min(540px,48vw)!important;border-left:1px solid #dfe1ed!important;}
  :global(.album-drawer .v2-drawer__close) {min-width:44px;min-height:44px;}
  .sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:960px) {.album-detail {overflow:auto;}.album-cover {min-height:175px;height:210px;}.album-main {flex:none;min-height:280px;}.member-list {height:320px;flex:none;}.cover-content {max-width:74%;}.selected-actions {flex-wrap:wrap;}.selected-actions>span {flex-basis:100%;}:global(.album-drawer) {width:100%!important;max-width:100%!important;}}
  @media(max-height:550px) {.album-cover {height:145px;min-height:145px;}.cover-content h2 {font-size:24px;}.member-list {min-height:160px;}}
</style>
