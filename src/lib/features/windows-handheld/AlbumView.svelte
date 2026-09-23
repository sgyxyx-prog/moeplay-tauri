<script lang="ts">
  import { onMount } from "svelte";
  import { invokeCmd } from "../../api/core";
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
  let addMode = $state(false);
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
  let notifiedMemberId: string | null = null;
  const filteredLocal = $derived(items.filter(item => item.title.toLocaleLowerCase().includes(addQuery.toLocaleLowerCase())).slice(0, 10_000));
  const linkItems = $derived(items.filter(item => item.title.toLocaleLowerCase().includes(linkQuery.toLocaleLowerCase())).slice(0, 10_000));

  onMount(() => { void catalogStore.load(); });
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
    try { await catalogStore.addMember(album.id, memberOf(item)); addMode = false; selectedMemberId = item.id; onmember(item.id); onselect(item); }
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
    <div class="album-lead"><div><span class="eyebrow">PERSONAL ARCHIVE / 01</span><h2>我的作品志</h2><p>把游戏、动画与原作编成自己的专题。</p></div><span class="issue-number">{String(catalogStore.albums.length).padStart(2, "0")}</span></div>
    <form class="create-line" onsubmit={event => { event.preventDefault(); void create(); }}>
      <label><span class="sr-only">新专题名称</span><input bind:value={newTitle} placeholder="给新专题起个名字" maxlength="80" /></label>
      <button type="button" onclick={() => void showSystemKeyboard()}>⌨ 键盘</button><button class="accent" type="submit" disabled={!newTitle.trim()}>创建专题</button>
    </form>
    {#if catalogStore.error}<p role="status">专题加载失败：{catalogStore.error}</p>{/if}
    {#if relationError}<p role="status">{relationError}</p>{/if}
    <div class="album-grid">
      {#each catalogStore.albums as entry, index (entry.id)}
        <button class="album-tile" onclick={() => { onalbum(entry.id); selectedMemberId = null; confirmDelete = false; }}>
          {#if entry.cover}<img src={entry.cover} alt="" loading="lazy" style={`object-position:${entry.focalX * 100}% ${entry.focalY * 100}%`} />{:else}<span class="tile-mark">{String(index + 1).padStart(2, "0")}</span>{/if}
          <span class="tile-copy"><small>{entry.pinned ? "置顶专题 · " : "专题 · "}{entry.members.length} 部作品</small><strong>{entry.title}</strong><em>{entry.description || "打开并继续编排"}</em></span>
        </button>
      {/each}
    </div>
  </section>
{:else}
  <section class="album-detail" aria-label={`专题 ${album.title}`}>
    <div class="album-cover">
      {#if album.cover}<img class="cover-image" src={album.cover} alt="" style={`object-position:${album.focalX * 100}% ${album.focalY * 100}%`} />{/if}
      <div class="cover-wash"></div>
      <div class="cover-content"><button class="back-link" onclick={() => { onalbum(null); selectedMemberId = null; confirmDelete = false; }}>← 我的专题</button><span class="eyebrow">MOEPLAY / PERSONAL ISSUE</span><h2>{album.title}</h2><p>{album.description || `${album.members.length} 部作品，按你喜欢的顺序编排。`}</p></div>
      <div class="cover-tools"><button onclick={() => imageInput?.click()}>更换封面</button><input bind:this={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={uploadCover} /><button onclick={() => void catalogStore.editAlbum(album.id, { pinned: !album.pinned })}>{album.pinned ? "取消置顶" : "置顶专题"}</button></div>
    </div>
    <div class="album-layout">
      <div class="album-main">
        <div class="section-title"><span class="eyebrow">CONTENTS</span><h3>作品目录</h3><button onclick={() => addMode = !addMode}>{addMode ? "完成添加" : "＋ 添加本机作品"}</button></div>
        {#if addMode}<div class="add-search"><input bind:value={addQuery} placeholder="搜索已入库的游戏、番剧、漫画或小说" aria-label="搜索本机作品" /><VirtualList items={filteredLocal} itemKey={item => item.id} estimateSize={62} label="可添加作品">{#snippet children(item)}<button class="pick-result" onclick={() => void add(item)}><span>{item.kind}</span><strong>{item.title}</strong><small>{item.progressLabel}</small></button>{/snippet}</VirtualList></div>{/if}
        {#if album.members.length}
          <div class="member-list"><VirtualList items={album.members} itemKey={member => member.id} estimateSize={100} focusId={selectedMember?.id} label="专题作品目录" onselect={selectMember}>
            {#snippet children(member, index)}<button class="member" class:selected={selectedMember?.id === member.id} class:drop-target={dropMemberId === member.id} data-album-member={member.id} draggable="true" ondragstart={event => { draggedMemberId = member.id; event.dataTransfer?.setData("text/plain", member.id); }} ondragover={event => { event.preventDefault(); dropMemberId = member.id; }} ondrop={event => { event.preventDefault(); const from = event.dataTransfer?.getData("text/plain") || draggedMemberId; if (album && from) void catalogStore.reorderMember(album.id, from, member.id); draggedMemberId = null; dropMemberId = null; }} ondragend={() => { draggedMemberId = null; dropMemberId = null; }} onpointerdown={event => startTouchReorder(event, member.id)} onpointermove={event => { if (draggedMemberId) dragAt(event); }} onpointerup={finishTouchReorder} onpointercancel={() => { draggedMemberId = null; dropMemberId = null; }} onclick={() => selectMember(member)} ondblclick={() => { const item = member.contentId ? localItems.get(member.contentId) : undefined; if (item) onopen(item); }}>
              <span class="chapter-index" title="触屏按住拖动排序">{String(index + 1).padStart(2, "0")}</span>{#if member.cover}<img src={member.cover} alt="" loading="lazy" />{:else}<span class="image-fallback">{member.kind}</span>{/if}<span class="member-copy"><small>{member.group || member.relation || "收录作品"} · {member.kind}</small><strong>{member.title}</strong><em>{member.contentId && localItems.get(member.contentId) ? localItems.get(member.contentId)?.progressLabel : "仅资料 · 尚未绑定可用内容"}</em></span><span aria-hidden="true">↗</span>
            </button>{/snippet}
          </VirtualList></div>
        {:else}<div class="empty">专题尚未收录作品。点击“添加本机作品”，或从作品的更多操作加入。</div>{/if}
      </div>
      <aside class="album-side">
        <div class="edit-block"><span class="eyebrow">EDITOR'S NOTE</span><label>专题标题<input value={album.title} maxlength="80" onchange={event => void catalogStore.editAlbum(album.id, { title: event.currentTarget.value.trim() || album.title })} /></label><label>简介<textarea value={album.description} maxlength="600" rows="2" onchange={event => void catalogStore.editAlbum(album.id, { description: event.currentTarget.value })}></textarea></label><label>封面横向位置<input type="range" min="0" max="100" value={album.focalX * 100} onchange={event => void catalogStore.editAlbum(album.id, { focalX: Number(event.currentTarget.value) / 100 })} /></label><label>封面纵向位置<input type="range" min="0" max="100" value={album.focalY * 100} onchange={event => void catalogStore.editAlbum(album.id, { focalY: Number(event.currentTarget.value) / 100 })} /></label></div>
        {#if selectedMember}
          <div class="member-tools"><span class="eyebrow">SELECTED WORK</span><h3>{selectedMember.title}</h3><p>{selectedMember.contentId && localItems.get(selectedMember.contentId) ? localItems.get(selectedMember.contentId)?.progressLabel : "仅资料 · 需要关联本机内容"}</p>
            {#if selectedMember.contentId && localItems.get(selectedMember.contentId)}<button class="accent" onclick={() => onopen(localItems.get(selectedMember.contentId!)!)}>继续使用</button>{:else}<button onclick={() => onsearch(selectedMember.title, selectedMember.kind)}>查找来源</button>{#if selectedMember.bangumiId}<button onclick={() => { linkSubject = { subjectId: selectedMember.bangumiId!, title: selectedMember.title, relation: selectedMember.relation, subjectType: selectedMember.kind === "book" ? 1 : selectedMember.kind === "anime" ? 2 : selectedMember.kind === "game" ? 4 : 0, cover: selectedMember.cover }; linkQuery = selectedMember.title; }}>关联本机内容</button>{/if}{/if}
            <div class="small-actions"><button onclick={() => void catalogStore.moveMember(album.id, selectedMember.id, -1)}>向前</button><button onclick={() => void catalogStore.moveMember(album.id, selectedMember.id, 1)}>向后</button><button onclick={() => void catalogStore.removeMember(album.id, selectedMember.id)}>移出专题</button></div>
            <label>分组<input value={selectedMember.group} maxlength="40" placeholder="例如：原作篇" onchange={event => void catalogStore.editMember(album.id, selectedMember.id, { group: event.currentTarget.value })} /></label>
            <label>我的短评<textarea value={selectedMember.note} maxlength="300" rows="2" onchange={event => void catalogStore.editMember(album.id, selectedMember.id, { note: event.currentTarget.value })}></textarea></label>
            {#if selectedMember.note}<p class="own-note">“{selectedMember.note}”</p>{/if}
            <button onclick={() => void loadRelations()}>查看 Bangumi 关联</button>
            {#if !selectedMember.bangumiId && !(selectedMember.contentId && catalogStore.getBinding(selectedMember.contentId))}<div class="bind-box"><label>确认条目<input bind:value={relationQuery} placeholder="搜索 Bangumi 标题" /></label><button onclick={() => void searchBangumi()} disabled={relationBusy || !relationQuery.trim()}>搜索条目</button>{#each relationResults as result}<button class="candidate" onclick={() => void bindMember(result.subjectId, result.subjectType)}>{result.title}<small>确认绑定 · Bangumi #{result.subjectId} · {result.subjectType === 1 ? "书籍（须对应漫画或小说）" : result.subjectType === 2 ? "动画" : "游戏"}</small></button>{/each}</div>{/if}
          </div>
        {/if}
        {#if relations.length || relationBusy || relationError}<div class="relations"><span class="eyebrow">RELATED WORKS / BANGUMI</span>{#if relationBusy}<p>正在查询关联作品…</p>{/if}{#if relationError}<p role="status">{relationError}</p>{/if}{#each relations.filter(entry => !album.ignoredSubjects.includes(entry.subjectId)) as related}<div class="relation"><span>{related.relation} · {related.subjectType === 1 ? "书籍（待确认漫画或小说）" : related.subjectType === 2 ? "动画" : related.subjectType === 4 ? "游戏" : "资料"}</span><strong>{related.title}</strong><div class="small-actions"><button onclick={() => void addRelation(related)}>加入专题</button><button onclick={() => { linkSubject = related; linkQuery = related.title; }}>关联已有内容</button><button onclick={() => void catalogStore.ignore(album.id, related.subjectId)}>忽略</button></div></div>{/each}</div>{/if}
        {#if linkSubject}<div class="link-box"><h3>关联：{linkSubject.title}</h3><input bind:value={linkQuery} aria-label="搜索本机内容进行关联" /><div class="link-results"><VirtualList items={linkItems} itemKey={item => item.id} estimateSize={56} label="可关联内容">{#snippet children(item)}<button onclick={() => void link(item)}>{item.title}<small>{item.kind}</small></button>{/snippet}</VirtualList></div><button onclick={() => linkSubject = null}>取消</button></div>{/if}
        <p class="storage-note">专题仅保存在本机，支持现有数据库导出与导入。</p>
        <div class="delete-tools">{#if confirmDelete}<span>仅删除专题编排，不删除作品或历史。</span><button onclick={() => confirmDelete = false}>取消</button><button class="danger" onclick={() => void catalogStore.removeAlbum(album.id).then(() => { confirmDelete = false; onalbum(null); }).catch(error => relationError = String(error))}>确认删除专题</button>{:else}<button onclick={() => confirmDelete = true}>删除专题</button>{/if}</div>
      </aside>
    </div>
  </section>
{/if}

<style>
  :global(.handheld-shell) { --album-paper:#f1ede3; --album-ink:#18191d; }
  .album-index,.album-detail { height:100%; min-height:0; scrollbar-width:thin; }
  .album-index {overflow:auto;} .album-detail {display:flex;flex-direction:column;overflow:hidden;}
  .eyebrow { color:var(--hh-accent); letter-spacing:.16em; font:700 11px/1.3 var(--font-mono,monospace); }
  .album-lead { display:flex;justify-content:space-between;align-items:end;padding:12px 0 16px;border-bottom:2px solid var(--hh-accent); }
  h2,h3,p { margin:0; } h2 { font-size:clamp(28px,3.4vw,52px);line-height:1.07;letter-spacing:-.045em; } h3 { font-size:20px;line-height:1.2; }
  .album-lead p { margin-top:8px; } .issue-number { font:800 clamp(58px,8vw,126px)/.8 var(--font-mono,monospace);opacity:.15; }
  .create-line { display:flex;gap:10px;padding:14px 0; } .create-line label { flex:1; } input,textarea { width:100%;min-height:44px;box-sizing:border-box;background:#f1ede30c;border:1px solid #f1ede343;border-radius:4px;color:inherit;padding:8px 12px;font:inherit; } input:focus-visible,textarea:focus-visible,button:focus-visible { outline:3px solid var(--hh-accent);outline-offset:2px; } textarea { resize:vertical; }
  button { color:inherit;cursor:pointer;background:#f1ede312;border:1px solid #f1ede34d;border-radius:3px;padding:8px 12px;min-height:44px;font:inherit; } .accent { background:var(--hh-accent);color:#171719;border-color:transparent;font-weight:800; }
  .album-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:12px;padding-bottom:24px; }
  .album-tile { position:relative;display:flex;align-items:end;min-height:220px;overflow:hidden;text-align:left;border:1px solid #fff3;background:linear-gradient(145deg,#3b3334,#181a1f);padding:0; }
  .album-tile:after { content:"";position:absolute;inset:0;background:linear-gradient(transparent 20%,#111d 95%);pointer-events:none; }
  .album-tile img { position:absolute;inset:0;width:100%;height:100%;object-fit:cover; } .tile-mark { position:absolute;top:10px;right:12px;font:800 64px/1 var(--font-mono,monospace);opacity:.32; }
  .tile-copy { position:relative;z-index:1;display:grid;gap:2px;padding:16px;min-width:0; } .tile-copy small { color:var(--hh-accent);font-size:12px; } .tile-copy strong { font-size:25px;line-height:1.15; } .tile-copy em {font-size:13px;font-style:normal;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .album-cover { height:clamp(170px,28vh,320px);min-height:170px;flex:none;position:relative;overflow:hidden;background:linear-gradient(130deg,#593c42,#17191e 68%);display:flex;align-items:end;padding:14px 20px;box-sizing:border-box; }
  .cover-image,.cover-wash { position:absolute;inset:0;width:100%;height:100%; } .cover-image { object-fit:cover; } .cover-wash { background:linear-gradient(90deg,#101217ee,#10121744 70%),linear-gradient(0deg,#101217bb,transparent 80%); }
  .cover-content,.cover-tools { position:relative;z-index:1; } .cover-content {max-width:68%;display:grid;gap:6px;} .cover-content h2 { margin:0; } .cover-content p {color:#f1ede3;} .cover-tools { margin-left:auto;display:grid;gap:6px; }
  .back-link { border:0;padding:6px 0;background:none;text-decoration:underline;text-underline-offset:4px; }
  .album-layout { display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.85fr);gap:14px;padding:14px 0;flex:1;min-height:0;overflow:hidden; }
  .album-main,.album-side { min-width:0;min-height:0;overflow:auto;scrollbar-width:thin; } .album-side {display:grid;align-content:start;gap:12px;}
  .section-title { display:flex;align-items:end;gap:10px;padding:8px 4px 12px;border-bottom:2px solid var(--hh-accent); }.section-title h3 {flex:1;}.section-title .eyebrow {writing-mode:vertical-rl;}
  .member-list { height:min(50vh,520px);min-height:250px; } .member {display:flex;align-items:center;width:100%;height:100%;gap:12px;padding:8px;text-align:left;border:0;border-bottom:1px solid #f1ede32b;border-radius:0;background:none;} .member.selected {background:#f1ede31a;box-shadow:inset 4px 0 var(--hh-accent);} .member.drop-target {outline:2px solid var(--hh-accent);outline-offset:-2px;} .member img,.image-fallback {width:60px;height:78px;flex:none;object-fit:cover;background:#37383a;display:grid;place-items:center;font-size:11px;} .chapter-index {align-self:start;font:800 18px var(--font-mono,monospace);color:var(--hh-accent);min-width:36px;min-height:44px;display:grid;place-items:center;touch-action:none;cursor:grab;} .member-copy {min-width:0;display:grid;flex:1;gap:2px;} .member-copy strong,.member-copy em {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .member-copy small {color:var(--hh-accent);} .member-copy em {font-size:13px;font-style:normal;color:#f1ede3aa;}
  .edit-block,.member-tools,.relations,.link-box {display:grid;gap:10px;padding:14px;background:#f1ede311;border-top:2px solid var(--hh-accent);} .edit-block label,.member-tools label,.bind-box label {display:grid;gap:5px;font-size:13px;color:#f1ede3bc;} .member-tools p,.storage-note {font-size:13px;color:#f1ede3ad;} .small-actions {display:flex;gap:5px;flex-wrap:wrap;} .small-actions button {min-height:40px;padding:5px 8px;font-size:13px;} .own-note {font-style:italic;} .bind-box {display:grid;gap:6px;} .candidate {display:grid;text-align:left;} .candidate small {font-size:11px;opacity:.7;}
  .relation {display:grid;gap:6px;border-bottom:1px solid #fff3;padding:8px 0;} .relation span {font-size:12px;color:var(--hh-accent);} .relation strong {font-size:15px;} .link-results,.add-search :global(.wh-virtual-list) {height:180px;} .add-search {display:grid;gap:6px;padding:10px 0;} .pick-result {display:flex;align-items:center;gap:10px;text-align:left;width:100%;height:100%;}.pick-result strong {flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.pick-result small {font-size:12px;opacity:.7;} .link-box .link-results button {display:flex;width:100%;justify-content:space-between;} .empty {padding:32px 16px;color:#f1ede3b0;}.storage-note {padding:0 8px;}.delete-tools {display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;color:#f1ede3aa;padding-bottom:15px;}.delete-tools .danger {border-color:#eb6d76;color:#ffadb4;}.sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}
  @media(max-width:960px) { .album-detail {overflow:auto;} .album-layout {grid-template-columns:1fr;overflow:visible;flex:none;} .album-main,.album-side {overflow:visible;} .cover-content {max-width:75%;} .album-cover {min-height:180px;height:26vh;} .cover-tools button {padding:6px;} }
  @media(max-height:550px) { .album-cover {min-height:120px;height:24vh;} .album-cover h2 {font-size:24px;} }
</style>
