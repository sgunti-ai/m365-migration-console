import { describe, expect, it } from "vitest";
import { createMigrationManifests } from "./sharepointMigration";

describe("SharePoint Migration API package generation", () => {
  it("creates required XML files and preserves file/folder hierarchy", () => {
    const result = createMigrationManifests([
      { driveId: "drive-1", itemId: "folder-1", name: "Finance", relativePath: "Finance", isFolder: true },
      { driveId: "drive-1", itemId: "file-1", name: "plan & budget.xlsx", relativePath: "Finance/plan & budget.xlsx", size: 128 },
    ]);

    expect(result.packageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(result.files)).toEqual(["Manifest.xml", "ExportSettings.xml", "SystemData.xml", "UserGroupMap.xml"]);
    expect(result.files["Manifest.xml"]).toContain("Folder Url=\"Finance\"");
    expect(result.files["Manifest.xml"]).toContain("plan &amp; budget.xlsx");
    expect(result.files["ExportSettings.xml"]).toContain('SourceType="OneDrive"');
    expect(result.files["SystemData.xml"]).toContain('ManifestFile Name="Manifest.xml"');
  });
});
