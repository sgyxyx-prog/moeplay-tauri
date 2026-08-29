import { describe, expect, it } from "vitest";
import {
  groupGamesBySystem,
  normalizePlatform,
  platformLabel,
  resolveEmulatorAssignments,
} from "./systems";

describe("handheld systems grouping", () => {
  it("normalizes emulator engine strings and casing", () => {
    expect(normalizePlatform("Emulator: psp")).toBe("psp");
    expect(normalizePlatform("PSP")).toBe("psp");
    expect(normalizePlatform("  ")).toBe("other");
    expect(normalizePlatform(null)).toBe("other");
  });

  it("groups visible games by platform, sorted by count", () => {
    const games = [
      { id: "1", name: "B", game_type: "gba" },
      { id: "2", name: "A", game_type: "Emulator: psp" },
      { id: "3", name: "C", game_type: "gba" },
      { id: "4", name: "D", game_type: "gba", hidden: true },
      { id: "5", name: "E", game_type: "psp" },
    ];
    const systems = groupGamesBySystem(games);
    expect(systems.map((s) => s.id)).toEqual(["gba", "psp"]);
    expect(systems[0].games.map((g) => g.name)).toEqual(["B", "C"]);
    expect(systems[0].label).toBe("GBA");
    expect(systems[1].label).toBe("PSP");
  });

  it("sorts favorites first within a system", () => {
    const systems = groupGamesBySystem([
      { id: "1", name: "Zelda", game_type: "gba" },
      { id: "2", name: "Advance Wars", game_type: "gba", favorite: true },
    ]);
    expect(systems[0].games.map((g) => g.name)).toEqual(["Advance Wars", "Zelda"]);
  });

  it("falls back to uppercase for unknown platform labels", () => {
    expect(platformLabel("wonderswan")).toBe("WONDERSWAN");
    expect(platformLabel("psp")).toBe("PSP");
  });
});

describe("handheld emulator assignment", () => {
  const installed = [
    { packageName: "com.retroarch.aarch64", label: "RetroArch" },
    { packageName: "org.ppsspp.ppsspp", label: "PPSSPP" },
    { packageName: "com.dsemu.drastic", label: "DraStic" },
  ];

  it("prefers dedicated emulators over RetroArch fallback", () => {
    const result = resolveEmulatorAssignments(["psp", "nds", "gba"], installed);
    expect(result.assignments["psp"]).toBe("org.ppsspp.ppsspp");
    expect(result.assignments["nds"]).toBe("com.dsemu.drastic");
    // gba 无专用模拟器（未装 Pizza Boy / My Boy），回退 RetroArch
    expect(result.assignments["gba"]).toBe("com.retroarch.aarch64");
    expect(result.fallback).toContain("gba");
    expect(result.fallback).not.toContain("psp");
    expect(result.missing).toEqual([]);
    expect(result.labels["psp"]).toBe("PPSSPP");
  });

  it("marks platforms missing when no emulator installed at all", () => {
    const result = resolveEmulatorAssignments(["psp"], []);
    expect(result.missing).toEqual(["psp"]);
    expect(result.assignments["psp"]).toBeUndefined();
  });

  it("uses first installed emulator when RetroArch absent", () => {
    const result = resolveEmulatorAssignments(["nes"], [
      { packageName: "org.ppsspp.ppsspp", label: "PPSSPP" },
    ]);
    expect(result.assignments["nes"]).toBe("org.ppsspp.ppsspp");
    expect(result.fallback).toContain("nes");
  });
});
