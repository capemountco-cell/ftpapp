import { describe, expect, it } from "vitest";

import type { Site } from "../lib/native";
import { matchSites, parseQuick } from "./Welcome";

describe("parseQuick", () => {
  it("reads a bare host", () => {
    expect(parseQuick(" Test.Rebex.net ")).toEqual({ scheme: null, user: "", pass: "", host: "test.rebex.net", port: null, path: "" });
  });
  it("reads a full link", () => {
    expect(parseQuick("sftp://deploy:s%40cret@example.com:2222/var/www")).toEqual({ scheme: "sftp", user: "deploy", pass: "s@cret", host: "example.com", port: 2222, path: "/var/www" });
  });
  it("maps ftpes to FTP with TLS and keeps a host:port", () => {
    expect(parseQuick("ftpes://demo@test.rebex.net").scheme).toBe("ftps");
    expect(parseQuick("example.com:21").port).toBe(21);
  });
});

describe("matchSites", () => {
  const site = (name: string, host: string) => ({ id: name, name, host }) as Site;
  const sites = [site("Northwind Production", "northwind.coffee"), site("GNU mirror", "ftp.gnu.org")];
  it("matches by name or server", () => {
    expect(matchSites(sites, "north").map((s) => s.id)).toEqual(["Northwind Production"]);
    expect(matchSites(sites, "sftp://me@ftp.gnu.org").map((s) => s.id)).toEqual(["GNU mirror"]);
    expect(matchSites(sites, "  ")).toEqual([]);
    expect(matchSites(sites, "test.rebex.net")).toEqual([]);
  });
});
