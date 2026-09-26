import { isTauri } from "@tauri-apps/api/core";
import { invokeCmd } from "../../api/core";
import type { ContentKind, HandheldContentItem } from "./types";

export interface AlbumMember {
  id: string;
  contentId: string | null;
  bangumiId: number | null;
  kind: ContentKind | "book";
  title: string;
  cover: string | null;
  group: string;
  note: string;
  relation: string;
}
export interface CollectionAlbum {
  id: string;
  title: string;
  description: string;
  cover: string | null;
  focalX: number;
  focalY: number;
  pinned: boolean;
  members: AlbumMember[];
  ignoredSubjects: number[];
  updatedAt: number;
}
export interface WorkBinding { contentId: string; bangumiId: number }
export interface CatalogDocument { schemaVersion: 1; revision: number; albums: CollectionAlbum[]; bindings: WorkBinding[] }
export interface WorkRelation { subjectId: number; title: string; relation: string; subjectType: number; cover: string | null }

const LOCAL_KEY = "moeplay-handheld-catalog-v1-preview";
export const emptyCatalog = (): CatalogDocument => ({ schemaVersion: 1, revision: 0, albums: [], bindings: [] });
export const memberOf = (item: HandheldContentItem): AlbumMember => ({
  id: item.id, contentId: item.id, bangumiId: null, kind: item.kind,
  title: item.title, cover: item.cover?.src ?? null, group: "", note: "", relation: "",
});
export function relationMember(relation: WorkRelation): AlbumMember {
  return { id: `bgm:${relation.subjectId}`, contentId: null, bangumiId: relation.subjectId,
    kind: relation.subjectType === 2 ? "anime" : relation.subjectType === 4 ? "game" : "book",
    title: relation.title, cover: relation.cover, group: "", note: "", relation: relation.relation };
}
export function moveMember(album: CollectionAlbum, memberId: string, delta: number): CollectionAlbum {
  const index = album.members.findIndex(member => member.id === memberId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= album.members.length) return album;
  const members = [...album.members];
  [members[index], members[target]] = [members[target], members[index]];
  return { ...album, members, updatedAt: Date.now() };
}
export function reorderMember(album: CollectionAlbum, memberId: string, targetId: string): CollectionAlbum {
  const from = album.members.findIndex(member => member.id === memberId);
  const to = album.members.findIndex(member => member.id === targetId);
  if (from < 0 || to < 0 || from === to) return album;
  const members = [...album.members];
  const [member] = members.splice(from, 1);
  members.splice(to, 0, member);
  return { ...album, members, updatedAt: Date.now() };
}

function localLoad(): CatalogDocument {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null") as CatalogDocument | null;
    return data?.schemaVersion === 1 ? data : emptyCatalog();
  } catch { return emptyCatalog(); }
}

let catalog = $state<CatalogDocument>(emptyCatalog());
let loading = $state(false);
let error = $state("");
let loaded = false;
let saveQueue = Promise.resolve();

async function read(): Promise<CatalogDocument> {
  return isTauri() ? invokeCmd<CatalogDocument>("handheld_catalog_get") : localLoad();
}
async function write(next: CatalogDocument): Promise<CatalogDocument> {
  if (isTauri()) return invokeCmd<CatalogDocument>("handheld_catalog_save", { catalog: next });
  const saved = { ...next, revision: next.revision + 1 };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
  return saved;
}
async function update(edit: (next: CatalogDocument) => void): Promise<void> {
  await catalogStore.load();
  const work = saveQueue.then(async () => {
    const next = $state.snapshot(catalog);
    edit(next);
    try { catalog = await write(next); error = ""; }
    catch (cause) { error = String(cause); catalog = await read(); throw cause; }
  });
  saveQueue = work.catch(() => {});
  await work;
}

export const catalogStore = {
  get catalog() { return catalog; },
  get albums() { return [...catalog.albums].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt); },
  get loading() { return loading; },
  get error() { return error; },
  getBinding(contentId: string) { return catalog.bindings.find(binding => binding.contentId === contentId)?.bangumiId ?? null; },
  async load() {
    if (loaded) return;
    loading = true;
    try { catalog = await read(); loaded = true; error = ""; }
    catch (cause) { error = String(cause); throw cause; }
    finally { loading = false; }
  },
  async refresh() { loaded = false; await this.load(); },
  async create(title: string) {
    const id = crypto.randomUUID();
    await update(next => next.albums.push({ id, title: title.trim(), description: "", cover: null,
      focalX: 0.5, focalY: 0.5, pinned: false, members: [], ignoredSubjects: [], updatedAt: Date.now() }));
    return id;
  },
  async editAlbum(id: string, patch: Partial<Omit<CollectionAlbum, "id" | "members" | "ignoredSubjects">>) {
    await update(next => { const album = next.albums.find(entry => entry.id === id); if (!album) throw new Error("专题不存在"); Object.assign(album, patch, { updatedAt: Date.now() }); });
  },
  async removeAlbum(id: string) { await update(next => { next.albums = next.albums.filter(album => album.id !== id); }); },
  async addMember(albumId: string, member: AlbumMember) {
    await update(next => { const album = next.albums.find(entry => entry.id === albumId); if (!album) throw new Error("专题不存在");
      if (!album.members.some(entry => entry.id === member.id || (member.bangumiId && entry.bangumiId === member.bangumiId))) album.members.push(member);
      album.updatedAt = Date.now(); });
  },
  async removeMember(albumId: string, memberId: string) {
    await update(next => { const album = next.albums.find(entry => entry.id === albumId); if (!album) return;
      album.members = album.members.filter(entry => entry.id !== memberId); album.updatedAt = Date.now(); });
  },
  async editMember(albumId: string, memberId: string, patch: Partial<Pick<AlbumMember, "group" | "note" | "kind" | "contentId">>) {
    await update(next => { const album = next.albums.find(entry => entry.id === albumId); const member = album?.members.find(entry => entry.id === memberId);
      if (!member || !album) throw new Error("专题作品不存在"); Object.assign(member, patch); album.updatedAt = Date.now(); });
  },
  async moveMember(albumId: string, memberId: string, delta: number) {
    await update(next => { const index = next.albums.findIndex(album => album.id === albumId);
      if (index >= 0) next.albums[index] = moveMember(next.albums[index], memberId, delta); });
  },
  async reorderMember(albumId: string, memberId: string, targetId: string) {
    await update(next => { const index = next.albums.findIndex(album => album.id === albumId);
      if (index >= 0) next.albums[index] = reorderMember(next.albums[index], memberId, targetId); });
  },
  async bind(contentId: string, bangumiId: number) {
    await update(next => { next.bindings = next.bindings.filter(entry => entry.contentId !== contentId);
      next.bindings.push({ contentId, bangumiId }); });
  },
  async linkMember(albumId: string, memberId: string, item: HandheldContentItem, bangumiId: number) {
    await update(next => {
      const album = next.albums.find(entry => entry.id === albumId);
      const index = album?.members.findIndex(member => member.id === memberId) ?? -1;
      if (!album || index < 0 || album.members[index].contentId) throw new Error("待关联作品不存在");
      if (album.members.some(member => member.contentId === item.id)) album.members.splice(index, 1);
      else album.members[index] = { ...album.members[index], ...memberOf(item), bangumiId,
        group: album.members[index].group, note: album.members[index].note, relation: album.members[index].relation };
      album.updatedAt = Date.now();
      next.bindings = next.bindings.filter(entry => entry.contentId !== item.id);
      next.bindings.push({ contentId: item.id, bangumiId });
    });
  },
  async ignore(albumId: string, subjectId: number) {
    await update(next => { const album = next.albums.find(entry => entry.id === albumId);
      if (album && !album.ignoredSubjects.includes(subjectId)) album.ignoredSubjects.push(subjectId); });
  },
  async relations(subjectId: number): Promise<WorkRelation[]> {
    return invokeCmd<WorkRelation[]>("handheld_bangumi_relations", { subjectId });
  },
};
