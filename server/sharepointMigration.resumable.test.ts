import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./graph", () => ({
  getGraphAccessToken: vi.fn().mockResolvedValue("graph-token"),
  getAppAccessToken: vi.fn().mockResolvedValue("sharepoint-token"),
}));

import { stageOneDrivePackageResumable } from "./sharepointMigration";

describe("resumable SharePoint staging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://source.test/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return new Response(null, { status: 201 });
    }));
  });

  it("skips completed items, stages the remainder, and reuses the package ID", async () => {
    const progress: Array<{ stagedFiles: number; completedItemIds: string[] }> = [];
    const result = await stageOneDrivePackageResumable([
      { driveId: "drive", itemId: "folder", name: "Finance", relativePath: "Finance", isFolder: true },
      { driveId: "drive", itemId: "file-1", name: "already.xlsx", relativePath: "Finance/already.xlsx", sourceUrl: "https://source.test/already" },
      { driveId: "drive", itemId: "file-2", name: "pending.xlsx", relativePath: "Finance/pending.xlsx", sourceUrl: "https://source.test/pending" },
    ], {
      config: { targetSiteUrl: "https://target.test", targetWebId: "web", sourceContainerSasUri: "https://blob.test/source", manifestContainerSasUri: "https://blob.test/manifests" },
      checkpoint: { packageId: "package-resume", completedItemIds: ["file-1"], stagedFiles: 1 },
      concurrency: 2,
      retryAttempts: 1,
      onProgress: (event) => progress.push({ stagedFiles: event.stagedFiles, completedItemIds: event.completedItemIds }),
    });

    expect(result.packageId).toBe("package-resume");
    expect(result.stagedFiles).toBe(2);
    expect(result.checkpoint.completedItemIds).toEqual(["file-1", "file-2"]);
    expect(progress.at(-1)?.stagedFiles).toBe(2);
    const sourceDownloads = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith("https://source.test/"));
    expect(sourceDownloads).toHaveLength(1);
  });
});
