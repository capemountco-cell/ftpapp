import { describe, expect, it } from "vitest";

import { api, errorText, nativeAvailable } from "./native";

describe("native bridge", () => {
  it("reports that it is not inside the Tauri window under test", () => {
    expect(nativeAvailable()).toBe(false);
  });

  it("refuses with a useful message instead of hanging", async () => {
    await expect(api.sites()).rejects.toThrow(/npm run dev/);
  });

  it("turns native errors into sentences", () => {
    expect(errorText({ kind: "auth", message: "Wrong password" })).toBe("Wrong password");
    expect(errorText({ kind: "notFound", path: "/x" })).toBe("/x doesn't exist.");
    expect(errorText(new Error("boom"))).toBe("boom");
  });
});
