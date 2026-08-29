// 掌机视图：把游戏库按「系统/平台」分组（ES-DE 的 system 维度）。
// 纯函数便于单测；HandheldPage 只负责渲染与交互。

export interface HandheldGameLike {
  id: string;
  name?: string | null;
  game_type?: string | null;
  favorite?: boolean | null;
  hidden?: boolean | null;
}

export interface HandheldSystem<T extends HandheldGameLike = HandheldGameLike> {
  /** 规范化平台 id（小写），如 psp / gba / windows */
  id: string;
  /** 展示名 */
  label: string;
  games: T[];
}

/** 平台 id → 中文/常用展示名；未知平台原样大写展示。 */
const PLATFORM_LABELS: Record<string, string> = {
  psp: "PSP",
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  psvita: "PS Vita",
  gamecube: "GameCube",
  wii: "Wii",
  switch: "Switch",
  nes: "FC / NES",
  snes: "SFC / SNES",
  n64: "N64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "GBA",
  nds: "NDS",
  "3ds": "3DS",
  md: "MD / Genesis",
  saturn: "SS / Saturn",
  dreamcast: "DC / Dreamcast",
  arcade: "街机",
  bbk: "步步高 BBK",
  j2me: "J2ME",
  msx: "MSX",
  pcengine: "PCE",
  pc98: "PC-98",
  virtualboy: "VB",
  wsc: "WonderSwan",
  ngpc: "NGP Color",
  pokemini: "Pokémon mini",
  gameandwatch: "Game & Watch",
  arduboy: "Arduboy",
  atari7800: "Atari 7800",
  supervision: "Supervision",
  vectrex: "Vectrex",
  zxspectrum: "ZX Spectrum",
  dos: "DOS",
  easyrpg: "EasyRPG",
  pico8: "PICO-8",
  tic80: "TIC-80",
  onscripter: "ONS 文字冒险",
  cdi: "CD-i",
  windows: "PC",
  steam: "Steam",
  epic: "Epic",
};

/**
 * 平台 → 启动模拟器包名优先级（首个命中已安装的即选用）。
 * 与插件 KNOWN_EMULATORS 清单对应；未列出的平台回退 RetroArch。
 */
const EMULATOR_PREFERENCES: Record<string, string[]> = {
  psp: ["org.ppsspp.ppsspp", "org.ppsspp.ppssppgold"],
  ps1: ["com.github.stenzek.duckstation", "com.epsxe.ePSXe", "com.emulator.fpse"],
  ps2: ["xyz.aethersx2.android"],
  nds: ["com.dsemu.drastic", "me.magnum.melonds"],
  n64: ["org.mupen64plusae.v3.fzurita.pro", "org.mupen64plusae.v3.fzurita", "com.nostalgiaemulators.n64"],
  "3ds": ["org.citra.emu", "org.citra.citra_emu", "org.citra.citra_canary", "io.github.lime3ds.android"],
  gba: ["it.dbtecno.pizzaboygbapro", "it.dbtecno.pizzaboygba", "com.fastemulator.gba"],
  gb: ["com.fastemulator.gbc"],
  gbc: ["com.fastemulator.gbc"],
  nes: ["com.nostalgiaemulators.nes1"],
  snes: ["com.nostalgiaemulators.snes1"],
  gamecube: ["org.dolphinemu.dolphinemu", "org.dolphinemu.mmjr"],
  wii: ["org.dolphinemu.dolphinemu", "org.dolphinemu.mmjr"],
  dreamcast: ["com.flycast.emulator", "io.recompiled.redream"],
  psvita: ["org.vita3k.emulator"],
  switch: ["org.yuzu.yuzu_emu", "skyline.emu"],
  onscripter: ["com.onscripter.plus"],
};

/** 全能型模拟器（RetroArch / Lemuroid），作为所有平台的兜底。 */
const FALLBACK_EMULATORS = [
  "com.retroarch.aarch64",
  "com.retroarch",
  "com.swordfish.lemuroid",
];

export interface EmulatorLike {
  packageName: string;
  label: string;
}

export interface EmulatorAssignment {
  /** platform → 选中的模拟器包名（一定存在） */
  assignments: Record<string, string>;
  /** platform → 模拟器显示名 */
  labels: Record<string, string>;
  /** 只能走兜底模拟器的平台 */
  fallback: string[];
  /** 连兜底模拟器都未安装 */
  missing: string[];
}

const OTHER_PLATFORM = "other";

/** game_type 归一化：Emulator: xxx / 大小写 / 空白统一成稳定平台 id。 */
export function normalizePlatform(gameType: string | null | undefined): string {
  const raw = (gameType ?? "").trim().toLowerCase();
  if (!raw) return OTHER_PLATFORM;
  const cleaned = raw.replace(/^emulator:\s*/, "").trim();
  return cleaned || OTHER_PLATFORM;
}

export function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] ?? id.toUpperCase();
}

/**
 * 给一组平台自动分配启动模拟器：
 * 专用模拟器优先（PSP→PPSSPP、NDS→DraStic…），其次 RetroArch 兜底，最后第一个已安装模拟器。
 */
export function resolveEmulatorAssignments(
  platforms: string[],
  installed: EmulatorLike[],
): EmulatorAssignment {
  const byPackage = new Map(installed.map((e) => [e.packageName, e]));
  const fallbackPkg =
    FALLBACK_EMULATORS.find((p) => byPackage.has(p)) ?? installed[0]?.packageName ?? null;

  const assignments: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const fallback: string[] = [];
  const missing: string[] = [];

  for (const platform of platforms) {
    const preferred = (EMULATOR_PREFERENCES[platform] ?? []).find((p) => byPackage.has(p));
    const chosen = preferred ?? fallbackPkg;
    if (!chosen) {
      missing.push(platform);
      continue;
    }
    assignments[platform] = chosen;
    labels[platform] = byPackage.get(chosen)?.label ?? chosen;
    if (!preferred) fallback.push(platform);
  }
  return { assignments, labels, fallback, missing };
}

/**
 * 游戏库 → 系统列表。按游戏数降序、再按名称；收藏优先策略交给排序函数。
 */
export function groupGamesBySystem<T extends HandheldGameLike>(games: T[]): HandheldSystem<T>[] {
  const buckets = new Map<string, T[]>();
  for (const game of games) {
    if (game.hidden) continue;
    const id = normalizePlatform(game.game_type);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(game);
    else buckets.set(id, [game]);
  }
  return [...buckets.entries()]
    .map(([id, list]) => ({
      id,
      label: platformLabel(id),
      games: sortGames(list),
    }))
    .sort((a, b) => b.games.length - a.games.length || a.label.localeCompare(b.label, "zh-CN"));
}

export function sortGames<T extends HandheldGameLike>(games: T[]): T[] {
  return [...games].sort((a, b) => {
    const fav = Number(b.favorite ?? false) - Number(a.favorite ?? false);
    if (fav !== 0) return fav;
    return (a.name ?? "").localeCompare(b.name ?? "", "zh-CN");
  });
}
