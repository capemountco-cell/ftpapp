import { describe, expect, it } from "vitest";

import {
  bytes,
  crumbs,
  duration,
  editable,
  extension,
  fileKind,
  fuzzy,
  join,
  kindLabel,
  modeFrom,
  parent,
  permsFrom,
  tilde,
  transferDetail,
  when,
} from "./format";
import type { Entry, Transfer } from "./native";

const entry = (name: string, kind: Entry["kind"] = "file", size = 10): Entry => ({
  name,
  path: "/" + name,
  kind,
  link: false,
  size,
  modified: null,
  permissions: null,
});

describe("format", () => {
  it("formats sizes like Finder", () => {
    expect(bytes(1)).toBe("1 byte");
    expect(bytes(999)).toBe("999 bytes");
    expect(bytes(1000)).toBe("1 KB");
    expect(bytes(1_482_330)).toBe("1.5 MB");
    expect(bytes(48_331_920)).toBe("48.3 MB");
    expect(bytes(512_000_000)).toBe("512 MB");
  });

  it("formats durations", () => {
    expect(duration(12.4)).toBe("12s");
    expect(duration(240)).toBe("4m");
    expect(duration(3900)).toBe("1h 5m");
  });

  it("formats times relative to now", () => {
    const now = new Date(2026, 10, 14, 12, 0, 0).getTime();
    const s = now / 1000;
    expect(when(null, now)).toBe("—");
    expect(when(s - 10, now)).toBe("Just now");
    expect(when(s - 300, now)).toBe("5m ago");
    expect(when(s - 86400, now)).toBe("Yesterday");
  });

  it("knows file kinds", () => {
    expect(extension(".htaccess")).toBe("htaccess");
    expect(extension("archive.tar.gz")).toBe("gz");
    expect(extension("Makefile")).toBe("");
    expect(fileKind(entry("a.PHP"))).toBe("code");
    expect(fileKind(entry("x", "dir"))).toBe("folder");
    expect(kindLabel(entry("hero.jpg"))).toBe("JPG image");
    expect(editable(entry("index.html"))).toBe(true);
    expect(editable(entry("hero.jpg"))).toBe(false);
    expect(editable(entry("big.log", "file", 5_000_000))).toBe(false);
  });

  it("splits and joins paths", () => {
    expect(crumbs("/var/www").map((c) => c.path)).toEqual(["/", "/var", "/var/www"]);
    expect(parent("/var/www")).toBe("/var");
    expect(parent("/var")).toBe("/");
    expect(parent("/")).toBeNull();
    expect(join("/", "etc")).toBe("/etc");
    expect(join("/var/", "www")).toBe("/var/www");
    expect(tilde("/home/me/site", "/home/me")).toBe("~/site");
    expect(tilde("/home/meow", "/home/me")).toBe("/home/meow");
  });

  it("matches loosely", () => {
    expect(fuzzy("Northwind Production", "prod")).toBe(10);
    expect(fuzzy("Northwind Production", "nwp")).not.toBeNull();
    expect(fuzzy("Staging", "xyz")).toBeNull();
  });

  it("round-trips permissions", () => {
    expect(modeFrom("rwxr-xr-x")).toBe(0o755);
    expect(modeFrom("drw-r--r--")).toBe(0o644);
    expect(permsFrom(0o640)).toBe("rw-r-----");
  });

  it("describes transfers", () => {
    const t = {
      state: "running",
      bytesDone: 1_000_000,
      bytesTotal: 3_000_000,
      rate: 1_000_000,
    } as Transfer;
    expect(transferDetail(t)).toBe("1 MB of 3 MB · 1 MB/s · 2s left");
    expect(transferDetail({ ...t, state: "failed", error: "Permission denied" })).toBe("Permission denied");
  });
});
