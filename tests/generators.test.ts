import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = process.cwd();
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
  "tests/soak",
  "vite.config.ts",
] as const;

const TEMPLATE_ONLY_FILES = [
  "scripts/rename-sim.ts",
  "scripts/scaffold-screens.ts",
  "tests/generators.test.ts",
  "doc/multi-screen.md",
  "doc/improvement-recommendations.md",
] as const;

const CHECK_FIXTURE_ENTRIES = [
  ".dependency-cruiser.cjs",
  ".gitignore",
  "biome.json",
  "biome-plugins",
  "playwright.config.ts",
  "tests/fuzz",
  "tests/helpers",
  "tsconfig.json",
  "tsconfig.scripts.json",
  "tsconfig.test.json",
  "vitest.config.ts",
  "vitest.soak.config.ts",
] as const;

const fixtureRoots: string[] = [];

function createFixture(includeChecks = false): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "scenerystack-generators-"));
  const fixture = join(fixtureRoot, "repo");
  mkdirSync(fixture);
  fixtureRoots.push(fixtureRoot);

  for (const entry of includeChecks ? [...FIXTURE_ENTRIES, ...CHECK_FIXTURE_ENTRIES] : FIXTURE_ENTRIES) {
    const source = join(PROJECT_ROOT, entry);
    const destination = join(fixture, entry);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }
  if (includeChecks) {
    symlinkSync(join(PROJECT_ROOT, "node_modules"), join(fixture, "node_modules"), "junction");
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

    const prefsNode = readFileSync(join(fixture, "src", "preferences", "WaveLabPreferencesNode.ts"), "utf8");
    expect(prefsNode).toContain("WaveLabPanel");
    expect(prefsNode).toContain('fill: "transparent"');

    const strings = readFileSync(join(fixture, "src", "i18n", "strings_en.json"), "utf8");
    expect(strings).not.toContain("exampleToggle");
    expect(strings).not.toContain("exampleControl");

    const view = readFileSync(join(fixture, "src", "wave-lab", "view", "WaveLabScreenView.ts"), "utf8");
    expect(view).not.toContain("placeholderText");
    expect(view).not.toContain("exampleControl");

    expect(existsSync(join(fixture, "src", "common", "TimeModel.ts"))).toBe(false);
    expect(existsSync(join(fixture, "src", "common", "WaveLabControlOptions.ts"))).toBe(false);
    expect(existsSync(join(fixture, "src", "common", "WaveLabPanel.ts"))).toBe(true);
    expect(existsSync(join(fixture, "src", "common", "WaveLabButtonOptions.ts"))).toBe(true);

    const knip = JSON.parse(readFileSync(join(fixture, "knip.json"), "utf8")) as { entry?: string[] };
    expect((knip.entry ?? []).some((entry) => /TimeModel|Panel|ControlOptions/.test(entry))).toBe(false);

    const qp = readFileSync(join(fixture, "src", "preferences", "waveLabQueryParameters.ts"), "utf8");
    expect(qp).not.toContain("export default");

    const sm = readFileSync(join(fixture, "src", "i18n", "StringManager.ts"), "utf8");
    expect(sm).not.toMatch(/export type \w+A11yStrings/);
    expect(sm).not.toMatch(/export type \w+PreferenceStrings/);

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

    const readme = readFileSync(join(fixture, "README.md"), "utf8");
    expect(readme).not.toContain("npm run rename");
    expect(readme).not.toContain("npm run scaffold-screens");
  });

  it("keeps the placeholder package-name guard intact after rename-only", () => {
    const fixture = createFixture();
    expectSuccess(runScript(fixture, "rename-sim.ts", ["--id", "wave-lab", "--name", "Wave Lab"]));

    const view = readFileSync(join(fixture, "src", "sim-screen", "view", "SimScreenView.ts"), "utf8");
    expect(view).toContain('["scenerystack", "template"].join("-")');
    expect(view).not.toMatch(/packageName === ["']wave-lab["']/);
    expect(view).toContain("placeholderText");
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
    expect(model).toContain("this.timer.dispose()");

    const prefsNode = readFileSync(join(fixture, "src", "preferences", "WaveLabPreferencesNode.ts"), "utf8");
    expect(prefsNode).toContain("WAVE_LAB_CHECKBOX_OPTIONS");
    expect(prefsNode).toContain("WaveLabControlOptions");

    const knip = JSON.parse(readFileSync(join(fixture, "knip.json"), "utf8")) as { entry?: string[] };
    expect((knip.entry ?? []).some((entry) => /TimeModel|ControlOptions|Panel/.test(entry))).toBe(false);

    const leak = readFileSync(join(fixture, "tests", "memory-leak.test.ts"), "utf8");
    expect(leak).toContain("composed TimeModel disposal");
    expect(leak).toContain('spyOn(model.timer, "dispose")');
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
  });

  it("strips demo strings from additional locales and preserves custom leak-suite content", () => {
    const fixture = createFixture();
    const locales = join(fixture, "src", "i18n");
    cpSync(join(locales, "strings_en.json"), join(locales, "strings_de.json"));
    const leakPath = join(fixture, "tests", "memory-leak.test.ts");
    const customNote = "// Custom leak regressions live outside the seed markers.";
    writeFileSync(leakPath, `${readFileSync(leakPath, "utf8")}\n${customNote}\n`, "utf8");

    renameAndScaffold(fixture, ["--screens", "Intro,Lab"]);

    const locale = readFileSync(join(locales, "strings_de.json"), "utf8");
    expect(locale).toContain('"intro": "Intro"');
    expect(locale).toContain('"lab": "Lab"');
    expect(locale).not.toMatch(/exampleToggle|exampleControl/);
    expect(readFileSync(leakPath, "utf8")).toContain(customNote);
  });

  it.each([
    { name: "default", args: [] },
    {
      name: "shared and opt-in starters",
      args: ["--screens", "Intro,Lab", "--shared-model", "--with-time-model", "--with-control-options"],
    },
  ])(
    "passes the required checks on a $name fork",
    ({ args }) => {
      const fixture = createFixture(true);
      renameAndScaffold(fixture, args);
      simulateTemplateOnlyRemoval(fixture);

      const npm = process.env["npm_execpath"];
      if (!npm) {
        throw new Error("Run the scaffold integration tests with npm test.");
      }
      for (const script of ["fix", "lint", "check", "check:architecture", "check:unused", "test"]) {
        const result = spawnSync(process.execPath, [npm, "run", script], {
          cwd: fixture,
          encoding: "utf8",
          timeout: 90_000,
        });
        expect(result.status, `${script}\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`).toBe(0);
      }
    },
    120_000,
  );
});
