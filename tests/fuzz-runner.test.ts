import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { JSONReport } from "@playwright/test/reporter";
import { expect, test } from "vitest";

test("a separate Playwright option value keeps discovery scoped to fuzz specs", async () => {
  const cwd = process.cwd();
  const reportDir = await mkdtemp(join(tmpdir(), "scenerystack-fuzz-"));
  const reportPath = join(reportDir, "report.json");
  try {
    await promisify(execFile)(process.execPath, ["scripts/test-fuzz.ts", "--list", "--reporter", "json"], {
      cwd,
      env: {
        ...process.env,
        PATH: [join(cwd, "node_modules", ".bin"), process.env["PATH"]].join(delimiter),
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
      },
    });
    const report = JSON.parse(await readFile(reportPath, "utf8")) as JSONReport;
    expect(report.suites.map((suite) => suite.file)).toEqual(["fuzz.spec.ts"]);
    expect(report.stats.skipped).toBe(2);
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});
