import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = process.cwd();
const BATON_ROOT = join(PROJECT_ROOT, "..", "Baton");
const FIXTURE_ENTRIES = [
  "AGENTS.md",
  "README.md",
  "doc",
  "index.html",
  "knip.json",
  "package-lock.json",
  "package.json",
  "scripts",
  "sim.config.json",
  "src",
  "tests/TimeModel.test.ts",
  "tests/generators.test.ts",
  "tests/memory-leak.test.ts",
  "tests/setup.ts",
  "vite.config.ts",
] as const;

const TEMPLATE_ONLY_FILES = [
  "scripts/rename-sim.ts",
  "scripts/scaffold-screens.ts",
  "tests/generators.test.ts",
  "doc/multi-screen.md",
  "doc/improvement-recommendations.md",
] as const;

const fixtureRoots: string[] = [];

function createFixture(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "scenerystack-generators-"));
  const fixture = join(fixtureRoot, "repo");
  mkdirSync(fixture);
  fixtureRoots.push(fixtureRoot);

  for (const entry of FIXTURE_ENTRIES) {
    const source = join(PROJECT_ROOT, entry);
    const destination = join(fixture, entry);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }
  return fixture;
}

function runScript(fixture: string, script: string, args: string[]) {
  return spawnSync(process.execPath, [join(fixture, "scripts", script), ...args], {
    cwd: fixture,
    encoding: "utf8",
  });
}

function expectSuccess(result: ReturnType<typeof runScript>): void {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function renameAndScaffold(fixture: string, args: string[] = []): void {
  expectSuccess(runScript(fixture, "rename-sim.ts", ["--id", "wave-lab", "--name", "Wave Lab"]));
  expectSuccess(runScript(fixture, "scaffold-screens.ts", args));
}

function simulateTemplateOnlyRemoval(fixture: string): void {
  for (const rel of TEMPLATE_ONLY_FILES) {
    const path = join(fixture, rel);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  }
  const pkgPath = join(fixture, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
  if (pkg.scripts) {
    const { rename: _r, "scaffold-screens": _s, ...scripts } = pkg.scripts;
    pkg.scripts = scripts;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
}

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("template generators", () => {
  it("sanitizes punctuation when deriving the simulation prefix", () => {
    const fixture = createFixture();

    expectSuccess(runScript(fixture, "rename-sim.ts", ["--id", "faradays-law", "--name", "Faraday's Law"]));
    expectSuccess(runScript(fixture, "scaffold-screens.ts", []));

    expect(existsSync(join(fixture, "src", "FaradaysLawColors.ts"))).toBe(true);
    for (const path of walkFiles(join(fixture, "src")).filter((file) => file.endsWith(".ts"))) {
      expect(basename(path)).not.toContain("'");
      expect(readFileSync(path, "utf8"), relative(fixture, path)).not.toContain("Faraday'sLaw");
    }
  });

  it("removes every template Sim-prefixed identifier after rename and scaffold", () => {
    const fixture = createFixture();
    renameAndScaffold(fixture, ["--screens", "Intro,Lab"]);

    for (const path of walkFiles(join(fixture, "src"))) {
      expect(relative(fixture, path), relative(fixture, path)).not.toMatch(/\bSim[A-Z_]|\bSIM_[A-Z_]/);
      if (path.endsWith(".ts")) {
        expect(readFileSync(path, "utf8"), relative(fixture, path)).not.toMatch(/\bSim[A-Z_]|\bSIM_[A-Z_]/);
      }
    }

    const introView = readFileSync(join(fixture, "src", "intro", "view", "IntroScreenView.ts"), "utf8");
    expect(introView).not.toContain('new Text("Intro"');
    expect(introView).toContain("IntroScreenSummaryContent");
  });

  it("rejects an empty screen list before changing the prototype", () => {
    const fixture = createFixture();
    const result = runScript(fixture, "scaffold-screens.ts", ["--screens", ","]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("At least one screen must be specified.");
    expect(existsSync(join(fixture, "src", "sim-screen", "SimScreen.ts"))).toBe(true);
    expect(existsSync(join(fixture, "src", "common", "SimScreenIcons.ts"))).toBe(false);
  });

  it("strips demos and emits short docs for single-screen forks", () => {
    const fixture = createFixture();
    renameAndScaffold(fixture, []);

    const prefs = readFileSync(join(fixture, "src", "preferences", "WaveLabPreferencesModel.ts"), "utf8");
    expect(prefs).not.toContain("exampleToggle");
    expect(prefs).toContain("No sim-specific preferences yet");

    const strings = readFileSync(join(fixture, "src", "i18n", "strings_en.json"), "utf8");
    expect(strings).not.toContain("exampleToggle");
    expect(strings).not.toContain("exampleControl");

    const view = readFileSync(join(fixture, "src", "wave-lab", "view", "WaveLabScreenView.ts"), "utf8");
    expect(view).not.toContain("placeholderText");
    expect(view).not.toContain("scenerystack-template");
    expect(view).not.toContain("exampleControl");

    expect(existsSync(join(fixture, "src", "common", "TimeModel.ts"))).toBe(false);
    expect(existsSync(join(fixture, "src", "common", "WaveLabControlOptions.ts"))).toBe(false);
    expect(existsSync(join(fixture, "src", "common", "WaveLabPanel.ts"))).toBe(true);
    expect(existsSync(join(fixture, "src", "common", "WaveLabButtonOptions.ts"))).toBe(true);

    const agents = readFileSync(join(fixture, "AGENTS.md"), "utf8");
    expect(agents).toContain("# AGENTS.md — Wave Lab");
    expect(agents).toContain("## Key files");
    expect(agents).toContain("## Compliance carve-outs");
    expect(agents).toContain("None yet.");
    expect(agents).not.toContain("Reusable SceneryStack template");

    expect(readFileSync(join(fixture, "doc", "model.md"), "utf8")).toContain("# Model — Wave Lab");
    expect(readFileSync(join(fixture, "doc", "implementation-notes.md"), "utf8")).toContain(
      "# Implementation notes — Wave Lab",
    );
  });

  it("keeps SharedModel free of exampleEnabledProperty and supports multi-screen", () => {
    const fixture = createFixture();
    renameAndScaffold(fixture, ["--screens", "Intro,Lab", "--shared-model"]);

    const shared = readFileSync(join(fixture, "src", "common", "model", "SharedModel.ts"), "utf8");
    expect(shared).not.toContain("exampleEnabledProperty");
    expect(shared).not.toContain("BooleanProperty");
    expect(shared).toContain("export class SharedModel");

    expect(existsSync(join(fixture, "src", "intro", "IntroScreen.ts"))).toBe(true);
    expect(existsSync(join(fixture, "src", "lab", "LabScreen.ts"))).toBe(true);

    const leak = readFileSync(join(fixture, "tests", "memory-leak.test.ts"), "utf8");
    expect(leak).toContain("IntroModel");
    expect(leak).toContain("LabModel");
    expect(leak).not.toContain("TimeModel");
  });

  it("opts into TimeModel and ControlOptions when requested", () => {
    const fixture = createFixture();
    renameAndScaffold(fixture, ["--with-time-model", "--with-control-options"]);

    expect(existsSync(join(fixture, "src", "common", "TimeModel.ts"))).toBe(true);
    expect(existsSync(join(fixture, "src", "common", "WaveLabControlOptions.ts"))).toBe(true);
    expect(existsSync(join(fixture, "tests", "TimeModel.test.ts"))).toBe(true);

    const model = readFileSync(join(fixture, "src", "wave-lab", "model", "WaveLabModel.ts"), "utf8");
    expect(model).toContain("new TimeModel()");
    expect(model).toContain("this.timer.step");
  });

  it("leaves live-template demos intact when scaffolding without rename", () => {
    const fixture = createFixture();
    expectSuccess(runScript(fixture, "scaffold-screens.ts", ["--screens", "Intro"]));

    expect(readFileSync(join(fixture, "src", "preferences", "SimPreferencesModel.ts"), "utf8")).toContain(
      "exampleToggleProperty",
    );
    expect(existsSync(join(fixture, "src", "common", "TimeModel.ts"))).toBe(true);
    expect(existsSync(join(fixture, "src", "common", "SimControlOptions.ts"))).toBe(true);
    expect(readFileSync(join(fixture, "AGENTS.md"), "utf8")).toContain("Reusable SceneryStack template");
  });

  it("validates the final generated state after template-only removal", () => {
    const fixture = createFixture();
    renameAndScaffold(fixture, ["--screens", "Intro,Lab", "--shared-model"]);
    simulateTemplateOnlyRemoval(fixture);

    for (const rel of TEMPLATE_ONLY_FILES) {
      expect(existsSync(join(fixture, rel)), rel).toBe(false);
    }
    const pkg = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["rename"]).toBeUndefined();
    expect(pkg.scripts?.["scaffold-screens"]).toBeUndefined();

    expect(readFileSync(join(fixture, "src", "preferences", "WaveLabPreferencesModel.ts"), "utf8")).not.toContain(
      "exampleToggle",
    );
    expect(readFileSync(join(fixture, "src", "common", "model", "SharedModel.ts"), "utf8")).not.toContain(
      "exampleEnabledProperty",
    );
    expect(existsSync(join(fixture, "src", "common", "TimeModel.ts"))).toBe(false);
    expect(readFileSync(join(fixture, "AGENTS.md"), "utf8")).toContain("## Compliance carve-outs");

    if (existsSync(join(BATON_ROOT, "scripts", "check-template-drift.mjs"))) {
      // Fixture omits many exact-owned files; assert only that template-only paths stay gone.
      const result = spawnSync(
        process.execPath,
        [
          join(BATON_ROOT, "scripts", "check-template-drift.mjs"),
          "--dir",
          fixture,
          "--name",
          "WaveLab",
          "--template",
          PROJECT_ROOT,
          "--json",
        ],
        { encoding: "utf8" },
      );
      const report = JSON.parse(result.stdout) as Array<{ issues: Array<{ kind: string; path: string }> }>;
      const templateOnlyIssues = (report[0]?.issues ?? []).filter((issue) => issue.kind === "template-only");
      expect(templateOnlyIssues, JSON.stringify(templateOnlyIssues, null, 2)).toEqual([]);
    }
  });
});
