#!/usr/bin/env node
/**
 * scripts/scaffold-screens.ts
 *
 * Emits N screen packages from the template's `src/sim-screen/` prototype
 * (fleet folder naming: `src/intro/`, not `intro-screen/`), wires main.ts,
 * StringManager, locale JSON, and a stub `{Prefix}ScreenIcons.ts` module, then
 * repoints AGENTS.md / README.md / doc/*.md at the emitted screens.
 *
 * Run after `npm run rename` (create-sim always does both). Safe on a pristine
 * template too (prefix stays `Sim`).
 *
 * Usage:
 *   npm run scaffold-screens -- --screens Intro,Lab
 *   npm run scaffold-screens -- --screens intro:Intro,"series-rlc:Series RLC"
 *   npm run scaffold-screens -- --screens Friction
 *   npm run scaffold-screens              # one screen from package.json display name / id
 *
 * Options:
 *   --screens <list>            Comma-separated titles, or kebab:Title pairs
 *   --prefix <Pascal>           Override sim prefix (default: detect from *Colors.ts)
 *   --shared-model              Emit src/common/model/SharedModel.ts; each screen model composes it
 *   --with-time-model           Keep src/common/TimeModel.ts (+ test) and compose it into screen models
 *   --with-control-options      Keep src/common/*ControlOptions.ts (default: remove for forks)
 *
 * Forks (package.json name ≠ scenerystack-template) get demos stripped: no live example*
 * strings/controls and no SharedModel exampleEnabledProperty. Commented showGrid /
 * accessible-control / TimeModel patterns stay as guidance, plus short
 * AGENTS.md / doc/model.md / doc/implementation-notes.md. The live template package keeps demos.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

// ── Argument parsing ──────────────────────────────────────────────────────────

interface ScaffoldArgs {
  screens?: string | undefined;
  prefix?: string | undefined;
  sharedModel: boolean;
  withTimeModel: boolean;
  withControlOptions: boolean;
}

function readArgs(): ScaffoldArgs {
  try {
    const { values } = parseArgs({
      options: {
        screens: { type: "string" },
        prefix: { type: "string" },
        "shared-model": { type: "boolean", default: false },
        "with-time-model": { type: "boolean", default: false },
        "with-control-options": { type: "boolean", default: false },
      },
    });
    return {
      screens: values.screens,
      prefix: values.prefix,
      sharedModel: values["shared-model"],
      withTimeModel: values["with-time-model"],
      withControlOptions: values["with-control-options"],
    };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Usage: npm run scaffold-screens -- [--screens <list>] [--prefix <Pascal>] [--shared-model] [--with-time-model] [--with-control-options]",
    );
    process.exit(1);
  }
}

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");

interface ScreenSpec {
  /** JSON / StringProperty key (camelCase): intro, seriesRlc */
  key: string;
  /** Folder name (kebab): intro, series-rlc */
  kebab: string;
  /** Class prefix (Pascal): Intro, SeriesRlc */
  pascal: string;
  /** Display title: Intro, Series RLC */
  title: string;
  /** Tandem id: introScreen */
  tandem: string;
}

function toKebab(input: string): string {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function kebabToPascal(kebab: string): string {
  const camel = kebabToCamel(kebab);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function titleToPascal(title: string): string {
  return title
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")
    .replace(/[^A-Za-z0-9]/g, "");
}

function parseScreens(raw: string | undefined): ScreenSpec[] {
  if (!raw || raw.trim() === "") {
    // Default: one screen from package name / README title leftovers
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      name?: string;
      description?: string;
    };
    const id = pkg.name && pkg.name !== "scenerystack-template" ? pkg.name : "sim";
    const titleGuess =
      // Prefer vite/html title already rewritten by rename
      (() => {
        try {
          const html = readFileSync(join(ROOT, "index.html"), "utf8");
          const m = html.match(/<title>([^<]+)<\/title>/);
          if (m?.[1] && m[1] !== "SceneryStack Template") {
            return m[1].trim();
          }
        } catch {
          // ignore
        }
        return null;
      })() ?? kebabToPascal(id);
    return [specFromParts(toKebab(id), titleGuess)];
  }

  // Split on commas not inside quotes
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
      continue;
    }
    if (ch === '"' && inQuotes) {
      inQuotes = false;
      continue;
    }
    if (ch === "," && !inQuotes) {
      if (cur.trim()) {
        parts.push(cur.trim());
      }
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) {
    parts.push(cur.trim());
  }

  return parts.map((part) => {
    const colon = part.indexOf(":");
    if (colon !== -1) {
      const kebab = toKebab(part.slice(0, colon));
      const title = part.slice(colon + 1).trim();
      return specFromParts(kebab, title);
    }
    const title = part.trim();
    return specFromParts(toKebab(title), title);
  });
}

function specFromParts(kebab: string, title: string): ScreenSpec {
  if (!kebab) {
    console.error("Invalid screen name (empty kebab).");
    process.exit(1);
  }
  const pascal = titleToPascal(title) || kebabToPascal(kebab);
  const key = kebabToCamel(kebab);
  return {
    key,
    kebab,
    pascal,
    title,
    tandem: `${key}Screen`,
  };
}

function detectPrefix(explicit: string | undefined): string {
  if (explicit) {
    return explicit;
  }
  const colors = readdirSync(SRC).filter((f) => f.endsWith("Colors.ts"));
  const only = colors.length === 1 ? colors[0] : undefined;
  if (only) {
    return basename(only, "Colors.ts");
  }
  if (existsSync(join(SRC, "SimColors.ts"))) {
    return "Sim";
  }
  console.error("Could not detect sim prefix from *Colors.ts; pass --prefix.");
  process.exit(1);
}

function replaceAll(str: string, search: string, replacement: string): string {
  return str.split(search).join(replacement);
}

function transformPrototype(text: string, screen: ScreenSpec, simPrefix: string): string {
  // Longest class names first
  let out = text;
  const pairs: [string, string][] = [
    ["SimScreenSummaryContent", `${screen.pascal}ScreenSummaryContent`],
    ["SimKeyboardHelpContent", `${screen.pascal}KeyboardHelpContent`],
    ["SimScreenView", `${screen.pascal}ScreenView`],
    ["SimScreen", `${screen.pascal}Screen`],
    ["SimModel", `${screen.pascal}Model`],
    ["getA11yStrings()", `get${screen.pascal}A11yStrings()`],
    [".simStringProperty", `.${screen.key}StringProperty`],
  ];
  for (const [from, to] of pairs) {
    out = replaceAll(out, from, to);
  }
  // The prototype header tells the reader to run scaffold-screens; in emitted screens that
  // advice is stale, so point at main.ts and the shared icon module instead.
  out = out.replace(
    / \* For multi-screen simulations, run `npm run scaffold-screens` \(preferred\) or\n \* duplicate this file \(e\.g\. IntroScreen\.ts, LabScreen\.ts\), add each screen to the\n \* screens array in src\/main\.ts, and put shared create\*Icon\(\) factories in\n \* src\/common\/\{SimName\}ScreenIcons\.ts \(see doc\/multi-screen\.md\)\.\n/,
    ` * Registered in the screens array in src/main.ts. Its home-screen and navigation-bar\n * icons come from create${screen.pascal}Icon() in src/common/${simPrefix}ScreenIcons.ts\n * (see doc/multi-screen.md).\n`,
  );

  // Inject screen icons into Screen class defaults when transforming *Screen.ts
  if (out.includes(`export class ${screen.pascal}Screen`) && !out.includes("homeScreenIcon")) {
    const iconImport = `import { create${screen.pascal}Icon } from "../common/${simPrefix}ScreenIcons.js";\n`;
    out = out.replace(
      `import ${simPrefix}Colors from "../${simPrefix}Colors.js";\n`,
      `import ${simPrefix}Colors from "../${simPrefix}Colors.js";\n${iconImport}`,
    );
    // Also handle still-SimColors path if somehow unchanged
    if (!out.includes(`${simPrefix}ScreenIcons`)) {
      out = out.replace(/import (\w+)Colors from "\.\.\/\1Colors\.js";\n/, (m) => `${m}${iconImport}`);
    }
    out = out.replace(
      `createKeyboardHelpNode: () => new ${screen.pascal}KeyboardHelpContent(),`,
      [
        `createKeyboardHelpNode: () => new ${screen.pascal}KeyboardHelpContent(),`,
        `          homeScreenIcon: create${screen.pascal}Icon(),`,
        `          navigationBarIcon: create${screen.pascal}Icon(),`,
      ].join("\n"),
    );
  }

  return out;
}

function findPrototypeDir(): string {
  const preferred = join(SRC, "sim-screen");
  if (existsSync(preferred) && existsSync(join(preferred, "SimScreen.ts"))) {
    return preferred;
  }
  // Legacy post-rename layout: {id}-screen/
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (!(entry.isDirectory() && entry.name.endsWith("-screen"))) {
      continue;
    }
    const full = join(SRC, entry.name);
    const screens = readdirSync(full).filter((f) => f.endsWith("Screen.ts") && !f.includes("View"));
    if (screens.length === 1) {
      return full;
    }
  }
  console.error("No prototype screen package found (expected src/sim-screen/).");
  process.exit(1);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function emitScreenPackage(protoDir: string, screen: ScreenSpec, simPrefix: string): void {
  const destRoot = join(SRC, screen.kebab);
  if (existsSync(destRoot)) {
    console.error(`Refusing to overwrite existing screen folder: src/${screen.kebab}/`);
    process.exit(1);
  }

  // Map prototype relative paths → dest paths with renamed filenames
  const files = walkFiles(protoDir);
  for (const from of files) {
    const rel = relative(protoDir, from);
    const destRel = rel
      .split(/[/\\]/)
      .map((seg) => {
        let s = seg;
        s = replaceAll(s, "SimScreenSummaryContent", `${screen.pascal}ScreenSummaryContent`);
        s = replaceAll(s, "SimKeyboardHelpContent", `${screen.pascal}KeyboardHelpContent`);
        s = replaceAll(s, "SimScreenView", `${screen.pascal}ScreenView`);
        s = replaceAll(s, "SimScreen", `${screen.pascal}Screen`);
        s = replaceAll(s, "SimModel", `${screen.pascal}Model`);
        // Legacy renamed prototype files ({Prefix}Screen.ts)
        if (simPrefix !== "Sim") {
          s = replaceAll(s, `${simPrefix}ScreenSummaryContent`, `${screen.pascal}ScreenSummaryContent`);
          s = replaceAll(s, `${simPrefix}KeyboardHelpContent`, `${screen.pascal}KeyboardHelpContent`);
          s = replaceAll(s, `${simPrefix}ScreenView`, `${screen.pascal}ScreenView`);
          s = replaceAll(s, `${simPrefix}Screen`, `${screen.pascal}Screen`);
          s = replaceAll(s, `${simPrefix}Model`, `${screen.pascal}Model`);
        }
        return s;
      })
      .join("/");

    const to = join(destRoot, destRel);
    mkdirSync(dirname(to), { recursive: true });
    let text = readFileSync(from, "utf8");

    // If prototype was already renamed at class level, map Prefix* → screen*
    if (simPrefix !== "Sim" && text.includes(`${simPrefix}Screen`)) {
      text = replaceAll(text, `${simPrefix}ScreenSummaryContent`, "SimScreenSummaryContent");
      text = replaceAll(text, `${simPrefix}KeyboardHelpContent`, "SimKeyboardHelpContent");
      text = replaceAll(text, `${simPrefix}ScreenView`, "SimScreenView");
      text = replaceAll(text, `${simPrefix}Screen`, "SimScreen");
      text = replaceAll(text, `${simPrefix}Model`, "SimModel");
    }

    text = transformPrototype(text, screen, simPrefix);
    writeFileSync(to, text, "utf8");
    console.log(`  wrote    ${relative(ROOT, to)}`);
  }
}

function writeScreenIcons(screens: ScreenSpec[], simPrefix: string): void {
  const path = join(SRC, "common", `${simPrefix}ScreenIcons.ts`);
  const exports = screens
    .map(
      (s) => `
export function create${s.pascal}Icon(): ScreenIcon {
  return iconFrom(
    new Node({
      children: [background()],
    }),
  );
}`,
    )
    .join("\n");

  const body = `/**
 * ${simPrefix}ScreenIcons.ts
 *
 * Programmatic home-screen / navigation-bar icons for each screen.
 * Drawn on the standard PhET 548 × 373 canvas using ${simPrefix}Colors.
 * Replace the stub backgrounds with screen-specific motifs.
 */
import { Node, Rectangle } from "scenerystack/scenery";
import { ScreenIcon } from "scenerystack/sim";
import ${simPrefix}Colors from "../${simPrefix}Colors.js";

const W = 548;
const H = 373;

function background(): Rectangle {
  return new Rectangle(0, 0, W, H, { fill: ${simPrefix}Colors.backgroundColorProperty });
}

function iconFrom(content: Node): ScreenIcon {
  return new ScreenIcon(content, {
    maxIconWidthProportion: 1,
    maxIconHeightProportion: 1,
    fill: ${simPrefix}Colors.backgroundColorProperty,
  });
}
${exports}
`;
  writeFileSync(path, body, "utf8");
  console.log(`  wrote    ${relative(ROOT, path)}`);
}

function localeFiles(): string[] {
  return readdirSync(join(SRC, "i18n")).filter((file) => /^strings_.+\.json$/.test(file));
}

function updateLocaleFiles(screens: ScreenSpec[]): void {
  for (const file of localeFiles()) {
    const path = join(SRC, "i18n", file);
    const json = JSON.parse(readFileSync(path, "utf8")) as {
      title: string;
      screens: Record<string, string>;
      a11y: Record<string, unknown>;
      preferences: unknown;
    };

    const flatA11y = json.a11y;
    // Detect the shape structurally: the single-screen prototype has screenSummary at the
    // top level, a scaffolded sim has it one level down under each screen key. Never infer
    // from the requested screen keys — a screen named "Controls" collides with the
    // prototype's a11y.controls block and would nest the wrong subtree.
    const isFlat = Object.hasOwn(flatA11y, "screenSummary");
    const firstNestedKey = Object.keys(flatA11y)[0];
    const templateA11y = isFlat
      ? flatA11y
      : firstNestedKey !== undefined
        ? (flatA11y[firstNestedKey] as Record<string, unknown>)
        : flatA11y;

    const screensObj: Record<string, string> = {};
    const a11yObj: Record<string, unknown> = {};
    for (const s of screens) {
      screensObj[s.key] = s.title;
      // Keep English template copy for es/fr stubs (translator can refine later)
      a11yObj[s.key] = structuredClone(templateA11y);
    }
    json.screens = screensObj;
    json.a11y = a11yObj;
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    console.log(`  updated  ${relative(ROOT, path)}`);
  }
}

function updateStringManager(screens: ScreenSpec[]): void {
  const path = join(SRC, "i18n", "StringManager.ts");
  let text = replaceSeedRegion(readFileSync(path, "utf8"), path, "reference-string-types");

  const nameFields = screens.map((s) => `    readonly ${s.key}StringProperty: ReadOnlyProperty<string>;`).join("\n");
  const nameReturns = screens
    .map((s) => `      ${s.key}StringProperty: stringProperties.screens.${s.key}StringProperty,`)
    .join("\n");

  const a11yGetters = screens
    .map(
      (s) => `  /** Accessibility strings for the ${s.title} screen. */
  public get${s.pascal}A11yStrings() {
    return stringProperties.a11y.${s.key};
  }`,
    )
    .join("\n\n");

  const methods = `  /**
   * The simulation title shown in the navigation bar and browser tab.
   * Updates automatically when the locale changes.
   */
  public getTitleStringProperty(): ReadOnlyProperty<string> {
    return stringProperties.titleStringProperty;
  }

  /**
   * Screen name StringProperties used when constructing Screen instances.
   * Each property updates automatically when the locale changes.
   */
  public getScreenNames(): {
${nameFields}
  } {
    return {
${nameReturns}
    };
  }

${a11yGetters}

  /**
   * Simulation-specific preference labels shown in Preferences → Simulation.
   */
  public getPreferences() {
    return stringProperties.preferences;
  }
}
`;

  // Replace from the first instance method through the end of the class.
  const start = text.indexOf("  /**\n   * The simulation title");
  const altStart = text.indexOf("  public getTitleStringProperty");
  const cut = start !== -1 ? start : altStart;
  if (cut === -1) {
    console.error("StringManager.ts: could not find getTitleStringProperty to rewrite.");
    process.exit(1);
  }
  // Drop any leftover methods if title block was already removed (re-run / partial)
  const classOpen = text.indexOf("export class StringManager");
  const getInstanceEnd = text.indexOf("return StringManager.instance;", classOpen);
  const afterGetInstance = text.indexOf("}", getInstanceEnd);
  const afterBlock = text.indexOf("}", afterGetInstance + 1);
  // Prefer cutting at title JSDoc when present; else right after getInstance()
  const rewriteFrom = cut !== -1 ? cut : afterBlock + 1;
  const before = text.slice(0, rewriteFrom).replace(/\s+$/, "\n\n");
  text = `${before}${methods}`;

  writeFileSync(path, text, "utf8");
  console.log(`  updated  ${relative(ROOT, path)}`);
}

function updateMain(screens: ScreenSpec[], simPrefix: string): void {
  const path = join(SRC, "main.ts");
  let text = readFileSync(path, "utf8");

  // Drop old screen imports (sim-screen or any ./…/…Screen.js)
  text = text.replace(/^import \{ \w+Screen \} from "\.\/.+Screen\.js";\n/gm, "");
  text = text.replace(/^import \{ \w+RootModel \} from "\.\/model\/\w+RootModel\.js";\n/gm, "");
  text = text.replace(/^import \{ SharedModel \} from "\.\/common\/model\/SharedModel\.js";\n/gm, "");

  const imports = screens
    .map((s) => `import { ${s.pascal}Screen } from "./${s.kebab}/${s.pascal}Screen.js";`)
    .join("\n");

  // Insert after SimColors / *Colors import
  if (/import \w+Colors from "\.\/\w+Colors\.js";\n/.test(text)) {
    text = text.replace(/(import \w+Colors from "\.\/\w+Colors\.js";\n)/, `$1${imports}\n`);
  } else {
    text = text.replace(/(import "\.\/brand\.js";\n)/, `$1\n${imports}\n`);
  }

  const screenEntries = screens
    .map(
      (s) => `    new ${s.pascal}Screen({
      name: stringManager.getScreenNames().${s.key}StringProperty,
      tandem: Tandem.ROOT.createTandem("${s.tandem}"),
      backgroundColorProperty: ${simPrefix}Colors.backgroundColorProperty,
    }),`,
    )
    .join("\n");

  const screensBlock = `  const screens = [
${screenEntries}
  ];`;

  text = text.replace(/ {2}const screens = \[[\s\S]*?\];/, screensBlock);

  writeFileSync(path, text, "utf8");
  console.log(`  updated  ${relative(ROOT, path)}`);
}

/**
 * Docs shipped with the template point at the `sim-screen/` prototype and its `Sim*`
 * classes, which no longer exist once screens are emitted. Rewrite those references to
 * the first screen (as the fleet forks did by hand) so no `Sim*` name survives the fork.
 */
function updateDocs(screens: ScreenSpec[], simPrefix: string): void {
  const first = screens[0];
  if (!first) {
    return;
  }
  const docDir = join(ROOT, "doc");
  const paths = [join(ROOT, "AGENTS.md"), join(ROOT, "README.md")];
  if (existsSync(docDir)) {
    for (const entry of readdirSync(docDir)) {
      if (entry.endsWith(".md")) {
        paths.push(join(docDir, entry));
      }
    }
  }

  // Longest names first so shorter ones do not eat their prefixes.
  const pairs: [string, string][] = [
    ["src/sim-screen", `src/${first.kebab}`],
    ["sim-screen/", `${first.kebab}/`],
    ["SimScreenSummaryContent", `${first.pascal}ScreenSummaryContent`],
    ["SimKeyboardHelpContent", `${first.pascal}KeyboardHelpContent`],
    ["SimScreenView", `${first.pascal}ScreenView`],
    ["SimScreenOptions", `${first.pascal}ScreenOptions`],
    ["SimScreen", `${first.pascal}Screen`],
    ["SimModel", `${first.pascal}Model`],
    ["getA11yStrings()", `get${first.pascal}A11yStrings()`],
    ["{SimName}ScreenIcons", `${simPrefix}ScreenIcons`],
  ];

  // Template-only prose in doc/multi-screen.md: token substitution alone would leave a
  // fork claiming to ship an un-scaffolded prototype.
  const screenList = screens.map((s) => `\`src/${s.kebab}/\``).join(", ");
  const prose: [string, string][] = [
    [
      "This template ships as a **single-screen** prototype (`src/sim-screen/`). New sims\nshould call `npm run scaffold-screens` (or `Baton/scripts/create-sim.sh`) so screen\nfolders use fleet naming (`src/intro/`, not `intro-screen/`). This guide covers the\narchitecture and how to extend an existing sim by hand.",
      `This sim was scaffolded by \`npm run scaffold-screens\` into ${screenList} (fleet naming:\nkebab folders with no \`-screen\` suffix). This guide covers the architecture and how to add\nanother screen by hand.`,
    ],
    [
      "## Automated scaffold (preferred)\n\nAfter `npm run rename` (or via `create-sim.sh`):",
      "## Automated scaffold (preferred)\n\nAlready run for this sim — the prototype folder is gone, so a second run exits early.\nKept as reference for the next sim:",
    ],
  ];

  for (const path of paths) {
    let original: string;
    try {
      original = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    let text = original;
    if (basename(path) === "multi-screen.md") {
      for (const [from, to] of prose) {
        text = replaceAll(text, from, to);
      }
    }
    for (const [from, to] of pairs) {
      text = replaceAll(text, from, to);
    }
    if (text !== original) {
      writeFileSync(path, text, "utf8");
      console.log(`  updated  ${relative(ROOT, path)}`);
    }
  }
}

/**
 * Fleet pattern (ACPhasor RlcCircuitModel, RotatingSky SkyModel, MotionsOfTheSun
 * TimeMaster): domain helpers live under common/model/ and each screen model
 * composes its own instance. Rename SharedModel to a domain noun when you know it.
 */
function writeSharedModel(): void {
  const dir = join(SRC, "common", "model");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SharedModel.ts");
  const body = `/**
 * SharedModel.ts
 *
 * Stub for cross-screen physics/state helpers. Lives under common/model/ per
 * Baton CONVENTIONS (no top-level src/model/). Fleet sims use domain names here
 * (e.g. SkyModel, RlcCircuitModel, TimeMaster) — rename this file when the
 * domain is clear.
 *
 * Each screen model typically owns its own instance (\`new SharedModel()\`), matching
 * ACPhasor / RotatingSky. For a single live instance shared across screens, construct
 * once in main.ts and pass it into each Screen/Model instead.
 */

export class SharedModel {
  public reset(): void {
    // Reset shared Properties here when added.
  }
}
`;
  writeFileSync(path, body, "utf8");
  console.log(`  wrote    ${relative(ROOT, path)}`);
}

function readPackageName(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name?: string };
  return pkg.name ?? "";
}

function isTemplatePackage(): boolean {
  return readPackageName() === "scenerystack-template";
}

function prefixToCamel(prefix: string): string {
  return prefix.charAt(0).toLowerCase() + prefix.slice(1);
}

function prefixToSnake(prefix: string): string {
  return prefix
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

function stripA11yExampleControls(a11y: Record<string, unknown>): void {
  const controlsValue = a11y["controls"];
  if (!(controlsValue && typeof controlsValue === "object")) {
    return;
  }
  const { exampleControl: _drop, ...rest } = controlsValue as Record<string, unknown>;
  if (Object.keys(rest).length === 0) {
    Reflect.deleteProperty(a11y, "controls");
  } else {
    a11y["controls"] = rest;
  }
}

function writeEmptyPreferencesShell(simPrefix: string, withControlOptions: boolean): void {
  const camel = prefixToCamel(simPrefix);
  const snake = prefixToSnake(simPrefix);
  const prefsDir = join(SRC, "preferences");

  const modelPath = join(prefsDir, `${simPrefix}PreferencesModel.ts`);
  writeFileSync(
    modelPath,
    `/**
 * ${simPrefix}PreferencesModel.ts
 *
 * Model for the simulation-specific preferences shown in Preferences →
 * Simulation. Keep this empty shell until the sim needs real preferences; the
 * optional tandem keeps main.ts wiring uniform.
 */
import type { Tandem } from "scenerystack/tandem";
import ${simPrefix}Namespace from "../${simPrefix}Namespace.js";
import "./${camel}QueryParameters.js";

export class ${simPrefix}PreferencesModel {
  // Pattern for a preference (skill: scenerystack-preferences). Every preference is
  // one chain: query parameter → Property here → label in every strings_*.json →
  // control in ${simPrefix}PreferencesNode → reset() below.
  //
  //   import { BooleanProperty } from "scenerystack/axon";
  //   import ${camel}QueryParameters from "./${camel}QueryParameters.js"; // replaces the bare import
  //
  //   public readonly showGridProperty: BooleanProperty;
  //
  //   // in the constructor (rename _tandem → tandem):
  //   this.showGridProperty = new BooleanProperty(
  //     ${camel}QueryParameters.showGrid,
  //     tandem ? { tandem: tandem.createTandem("showGridProperty") } : undefined,
  //   );
  //
  //   // in reset():
  //   this.showGridProperty.reset();

  public constructor(_tandem?: Tandem) {
    // Attach preference Properties under this tandem when added.
  }

  public reset(): void {
    // No sim-specific preferences yet.
  }
}

${simPrefix}Namespace.register("${simPrefix}PreferencesModel", ${simPrefix}PreferencesModel);
`,
    "utf8",
  );
  console.log(`  stripped ${relative(ROOT, modelPath)}`);

  const controlImport = withControlOptions
    ? `import { ${snake}_CHECKBOX_OPTIONS } from "../common/${simPrefix}ControlOptions.js";\n`
    : "";
  const contentSpacing = withControlOptions ? `${snake}_CHECKBOX_OPTIONS.spacing` : "12";
  const checkboxSpread = withControlOptions
    ? `//       ...${snake}_CHECKBOX_OPTIONS,`
    : `//       // Shared slider / NumberControl / checkbox bundles live in ${simPrefix}ControlOptions.ts:
//       // copy the template's src/common/*ControlOptions.ts and apply the ${simPrefix} prefix.`;

  // Use Panel to theme the empty shell (visually empty) so architecture reaches *Panel.ts.
  const nodePath = join(prefsDir, `${simPrefix}PreferencesNode.ts`);
  writeFileSync(
    nodePath,
    `/**
 * ${simPrefix}PreferencesNode.ts
 *
 * Custom preferences UI shown in Preferences → Simulation. Add controls here
 * when the sim gains sim-specific preferences. The empty shell still wraps content
 * in ${simPrefix}Panel so the shared panel toolkit stays reachable.
 */
import { VBox } from "scenerystack/scenery";
import type { Tandem } from "scenerystack/tandem";
import { ${simPrefix}Panel } from "../common/${simPrefix}Panel.js";
${controlImport}import ${simPrefix}Namespace from "../${simPrefix}Namespace.js";
import type { ${simPrefix}PreferencesModel } from "./${simPrefix}PreferencesModel.js";

export class ${simPrefix}PreferencesNode extends VBox {
  public constructor(_preferencesModel: ${simPrefix}PreferencesModel, _tandem?: Tandem) {
    // Pattern for a preference control (skill: scenerystack-preferences). The dialog is
    // always white, so use the controlSurface colors, not textColorProperty.
    //
    //   const prefStrings = StringManager.getInstance().getPreferences();
    //   const showGridCheckbox = new Checkbox(
    //     preferencesModel.showGridProperty,
    //     new Text(prefStrings.showGridStringProperty, {
    //       font: new PhetFont(14),
    //       fill: ${simPrefix}Colors.controlSurfaceTextColorProperty,
    //     }),
    //     {
    ${checkboxSpread}
    //       checkboxColor: ${simPrefix}Colors.controlSurfaceTextColorProperty,
    //       checkboxColorBackground: ${simPrefix}Colors.controlSurfaceColorProperty,
    //       ...(tandem && { tandem: tandem.createTandem("showGridCheckbox") }),
    //     },
    //   );
    //
    // Add showGridCheckbox to the content children below.
    const content = new VBox({
      align: "left",
      spacing: ${contentSpacing},
      children: [],
    });
    // Transparent / borderless so the Preferences dialog stays visually empty.
    const panel = new ${simPrefix}Panel(content, {
      fill: "transparent",
      stroke: null,
      xMargin: 0,
      yMargin: 0,
    });
    super({
      align: "left",
      spacing: 12,
      children: [panel],
    });
  }
}

${simPrefix}Namespace.register("${simPrefix}PreferencesNode", ${simPrefix}PreferencesNode);
`,
    "utf8",
  );
  console.log(`  stripped ${relative(ROOT, nodePath)}`);

  const qpPath = join(prefsDir, `${camel}QueryParameters.ts`);
  writeFileSync(
    qpPath,
    `/**
 * ${camel}QueryParameters.ts
 *
 * Sim-specific startup query parameters. Declare each public parameter here and
 * initialize matching preference Properties from them when needed.
 *
 * Side-effect module while empty: imported from the preferences model so Knip
 * keeps the file without an unused default export.
 */
import { logGlobal } from "scenerystack/phet-core";
import { QueryStringMachine } from "scenerystack/query-string-machine";
import ${simPrefix}Namespace from "../${simPrefix}Namespace.js";

const ${camel}QueryParameters = QueryStringMachine.getAll({
  // Pattern (skill: scenerystack-query-parameters): one typed entry per parameter.
  // Mark it public only if users may set it from the URL. When the first entry is
  // added, make ${camel}QueryParameters the module's default export and import it by
  // name from ${simPrefix}PreferencesModel.
  //
  //   showGrid: { type: "boolean", defaultValue: false, public: true },
});

${simPrefix}Namespace.register("${camel}QueryParameters", ${camel}QueryParameters);

logGlobal("phet.chipper.queryParameters");
`,
    "utf8",
  );
  console.log(`  stripped ${relative(ROOT, qpPath)}`);
}

function stripLocaleDemoStrings(): void {
  for (const file of localeFiles()) {
    const path = join(SRC, "i18n", file);
    const json = JSON.parse(readFileSync(path, "utf8")) as {
      preferences?: Record<string, unknown>;
      a11y?: Record<string, unknown>;
    };
    if (json.preferences && "exampleToggle" in json.preferences) {
      const { exampleToggle: _drop, ...rest } = json.preferences;
      json.preferences = rest;
    }
    if (json.a11y) {
      if (Object.hasOwn(json.a11y, "screenSummary")) {
        stripA11yExampleControls(json.a11y);
      } else {
        for (const value of Object.values(json.a11y)) {
          if (value && typeof value === "object") {
            stripA11yExampleControls(value as Record<string, unknown>);
          }
        }
      }
    }
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    console.log(`  stripped ${relative(ROOT, path)}`);
  }
}

function replaceSeedRegion(text: string, path: string, name: string, replacement = ""): string {
  const start = new RegExp(`^[ \t]*// seed:${name}:start[ \t]*\r?$`, "gm");
  const end = new RegExp(`^[ \t]*// seed:${name}:end[ \t]*\r?$`, "gm");
  const starts = [...text.matchAll(start)];
  const ends = [...text.matchAll(end)];
  const first = starts[0]?.index;
  const last = ends[0];
  if (starts.length !== 1 || ends.length !== 1 || first === undefined || !last || last.index < first) {
    throw new Error(`${relative(ROOT, path)}: expected one ordered seed:${name} region`);
  }
  const after = last.index + last[0].length + 1;
  return text.slice(0, first) + replacement + text.slice(after);
}

/** The template's commented example, renamed so compliance's placeholder grep stays clean. */
const ACCESSIBLE_CONTROL_PATTERN = `    // Example (uncomment and adapt when you add a real control; add the
    // \`a11y.controls.startButton\` string to every strings_*.json first):
    //
    //   const a11y = StringManager.getInstance().getA11yStrings();
    //   const startButton = new RectangularPushButton({
    //     ...FLAT_RECTANGULAR_BUTTON_OPTIONS, // flat appearance, not SceneryStack's default 3-D look
    //     content: someIcon,
    //     listener: () => model.start(),
    //     accessibleName: a11y.controls.startButtonStringProperty,
    //   });
    //   this.addChild(startButton);
`;

function stripScreenViewDemos(screens: ScreenSpec[]): void {
  for (const screen of screens) {
    const path = join(SRC, screen.kebab, "view", `${screen.pascal}ScreenView.ts`);
    let view = readFileSync(path, "utf8");
    view = replaceSeedRegion(view, path, "placeholder");
    view = replaceSeedRegion(view, path, "accessible-control", ACCESSIBLE_CONTROL_PATTERN);
    const importedText = /\/\* template-demo \*\/\s*Text\s*,?/g;
    const demoImports = /^import[^;]+;[ \t]*\/\/ template-demo[ \t]*\r?\n/gm;
    if ([...view.matchAll(importedText)].length !== 1 || [...view.matchAll(demoImports)].length !== 2) {
      throw new Error(`${relative(ROOT, path)}: missing template demo import markers`);
    }
    view = view.replace(importedText, "").replace(demoImports, "");
    writeFileSync(path, view, "utf8");
    console.log(`  stripped ${relative(ROOT, path)}`);
  }
}

/** Empty CapacitorLab-style preferences trio + locale/type cleanup for forks. */
function stripDemoContent(simPrefix: string, screens: ScreenSpec[], withControlOptions: boolean): void {
  writeEmptyPreferencesShell(simPrefix, withControlOptions);
  stripLocaleDemoStrings();
  stripScreenViewDemos(screens);
}

function removeOptionalStarterFiles(args: ScaffoldArgs, simPrefix: string): void {
  const controlOptionsPath = join(SRC, "common", `${simPrefix}ControlOptions.ts`);
  if (!args.withControlOptions && existsSync(controlOptionsPath)) {
    rmSync(controlOptionsPath);
    console.log(`  removed  ${relative(ROOT, controlOptionsPath)} (pass --with-control-options to keep)`);
  }

  if (args.withTimeModel) {
    return;
  }
  const timeModelPath = join(SRC, "common", "TimeModel.ts");
  const timeModelTestPath = join(ROOT, "tests", "TimeModel.test.ts");
  if (existsSync(timeModelPath)) {
    rmSync(timeModelPath);
    console.log(`  removed  ${relative(ROOT, timeModelPath)} (pass --with-time-model to keep)`);
  }
  if (existsSync(timeModelTestPath)) {
    rmSync(timeModelTestPath);
    console.log(`  removed  ${relative(ROOT, timeModelTestPath)}`);
  }
}

function composeTimeModel(screens: ScreenSpec[]): void {
  for (const screen of screens) {
    const modelPath = join(SRC, screen.kebab, "model", `${screen.pascal}Model.ts`);
    let model = readFileSync(modelPath, "utf8");
    if (model.includes("TimeModel")) {
      continue;
    }
    model = model.replace(
      /import type \{ TModel \} from "scenerystack\/joist";\n/,
      `import type { TModel } from "scenerystack/joist";\nimport { TimeModel } from "../../common/TimeModel.js";\n`,
    );
    model = model.replace(
      new RegExp(`export class ${screen.pascal}Model implements TModel \\{\\n`),
      `export class ${screen.pascal}Model implements TModel {\n  public readonly timer = new TimeModel();\n\n`,
    );
    if (model.includes("public reset(): void {") && !model.includes("this.timer.reset()")) {
      model = model.replace(/public reset\(\): void \{\n/, "public reset(): void {\n    this.timer.reset();\n");
    }
    if (model.includes("public step(_dt: number): void {") && !model.includes("this.timer.step")) {
      model = model.replace("@param _dt -", "@param dt -");
      model = model.replace(
        /public step\(_dt: number\): void \{\n\s*\/\/ TODO: advance simulation state here\n\s*\}/,
        "public step(dt: number): void {\n    this.timer.step(dt);\n    // TODO: advance simulation state here\n  }",
      );
    }
    writeFileSync(modelPath, model, "utf8");
    console.log(`  updated  ${relative(ROOT, modelPath)} (TimeModel)`);
  }
}

const TIME_MODEL_POINTER = `    // For play/pause, speed, and elapsed time, compose TimeModel instead of hand-rolling
    // a clock: copy src/common/TimeModel.ts (and tests/TimeModel.test.ts) from
    // SceneryStackTemplate unchanged — Baton's drift check requires an exact match —
    // then hold one in a readonly \`timer\` field, step/reset/dispose it, and list it
    // in tests/memory-leak.test.ts.
`;

/** Point dropped-TimeModel forks at the template copy instead of a hand-rolled clock. */
function addTimeModelPointer(screens: ScreenSpec[]): void {
  for (const screen of screens) {
    const modelPath = join(SRC, screen.kebab, "model", `${screen.pascal}Model.ts`);
    const model = readFileSync(modelPath, "utf8");
    const updated = model.replace(/(\n {2}public step\(_dt: number\): void \{\n)/, `$1${TIME_MODEL_POINTER}`);
    if (updated === model) {
      throw new Error(`${relative(ROOT, modelPath)}: could not find step(_dt) for the TimeModel pointer`);
    }
    writeFileSync(modelPath, updated, "utf8");
    console.log(`  updated  ${relative(ROOT, modelPath)} (TimeModel pointer)`);
  }
}

function ensureScreenModelDispose(screens: ScreenSpec[], withTimeModel: boolean): void {
  for (const screen of screens) {
    const modelPath = join(SRC, screen.kebab, "model", `${screen.pascal}Model.ts`);
    let model = readFileSync(modelPath, "utf8");
    const disposeBody = withTimeModel ? "    this.timer.dispose();\n" : "    // No resources yet.\n";
    if (/\bdispose\s*\(/.test(model)) {
      if (withTimeModel && !model.includes("this.timer.dispose()")) {
        model = model.replace(
          /public dispose\(\): void \{\n(?:\s*\/\/[^\n]*\n)?/,
          `public dispose(): void {\n    this.timer.dispose();\n`,
        );
        writeFileSync(modelPath, model, "utf8");
        console.log(`  updated  ${relative(ROOT, modelPath)} (timer dispose)`);
      }
      continue;
    }
    model = model.replace(
      /\n\}\n?\s*$/,
      `\n\n  /** Release owned Properties / composed models. */\n  public dispose(): void {\n${disposeBody}  }\n}\n`,
    );
    writeFileSync(modelPath, model, "utf8");
    console.log(`  updated  ${relative(ROOT, modelPath)} (dispose)`);
  }
}

function applyOptionalStarters(args: ScaffoldArgs, simPrefix: string, screens: ScreenSpec[]): void {
  removeOptionalStarterFiles(args, simPrefix);
  if (args.withTimeModel) {
    composeTimeModel(screens);
  } else {
    addTimeModelPointer(screens);
  }
  ensureScreenModelDispose(screens, args.withTimeModel);

  // Template starter knip entries are template-only. Forks must use the modules
  // (Panel / optional TimeModel / ControlOptions) rather than retain the entries —
  // even when --with-time-model keeps TimeModel.ts on disk.
  const knipPath = join(ROOT, "knip.json");
  if (existsSync(knipPath)) {
    const knip = JSON.parse(readFileSync(knipPath, "utf8")) as { entry?: string[] };
    if (Array.isArray(knip.entry)) {
      const starterEntries = new Set([
        "src/common/TimeModel.ts!",
        `src/common/${simPrefix}Panel.ts!`,
        `src/common/${simPrefix}ControlOptions.ts!`,
      ]);
      knip.entry = knip.entry.filter((entry) => !starterEntries.has(entry));
      writeFileSync(knipPath, `${JSON.stringify(knip, null, 2)}\n`, "utf8");
      console.log(`  updated  ${relative(ROOT, knipPath)}`);
    }
  }

  const leakPath = join(ROOT, "tests", "memory-leak.test.ts");
  const cases = screens.map((s) => `{ name: "${s.pascal}Model", create: () => new ${s.pascal}Model() }`);
  const imports = screens.map((s) => `import { ${s.pascal}Model } from "../src/${s.kebab}/model/${s.pascal}Model.js";`);
  if (args.withTimeModel) {
    cases.unshift('{ name: "TimeModel", create: () => new TimeModel(), idempotentDispose: true }');
    imports.unshift(
      'import { describe, expect, it, vi } from "vitest";',
      'import { TimeModel } from "../src/common/TimeModel.js";',
    );
  }
  const timerAssert = args.withTimeModel
    ? `

describe("composed TimeModel disposal", () => {
  it("screen models dispose their owned timer", () => {
${screens
  .map(
    (s) => `    {
      const model = new ${s.pascal}Model();
      const spy = vi.spyOn(model.timer, "dispose");
      model.dispose();
      expect(spy).toHaveBeenCalledOnce();
    }`,
  )
  .join("\n")}
  });
});
`
    : "";
  let leakSuite = readFileSync(leakPath, "utf8");
  leakSuite = replaceSeedRegion(leakSuite, leakPath, "leak-imports", `${imports.join("\n")}\n`);
  leakSuite = replaceSeedRegion(
    leakSuite,
    leakPath,
    "leak-cases",
    `describeDisposalLeaks([${cases.join(", ")}]);\n${timerAssert}`,
  );
  writeFileSync(leakPath, leakSuite, "utf8");
  console.log(`  updated  ${relative(ROOT, leakPath)}`);
}

/** Point the by-hand headless soak (tests/soak/headless.soak.ts) at the emitted screens. */
function updateSoakSuite(screens: ScreenSpec[], simPrefix: string): void {
  const soakPath = join(ROOT, "tests", "soak", "headless.soak.ts");
  const imports = [
    `import ${simPrefix}Colors from "../../src/${simPrefix}Colors.js";`,
    ...screens.map((s) => `import { ${s.pascal}Screen } from "../../src/${s.kebab}/${s.pascal}Screen.js";`),
  ];
  const entries = screens.map(
    (s) => `    new ${s.pascal}Screen({ name: new StringProperty("${s.title}"), tandem: Tandem.OPT_OUT }),`,
  );
  let soak = readFileSync(soakPath, "utf8");
  soak = replaceSeedRegion(soak, soakPath, "soak-imports", `${imports.join("\n")}\n`);
  soak = replaceSeedRegion(
    soak,
    soakPath,
    "soak-screens",
    `  screens: () => [\n${entries.join("\n")}\n  ],\n  tracked: () => ({ ${simPrefix}Colors }),\n`,
  );
  writeFileSync(soakPath, soak, "utf8");
  console.log(`  updated  ${relative(ROOT, soakPath)}`);
}

function writeSeedDocs(simPrefix: string, screens: ScreenSpec[], args: ScaffoldArgs): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    name?: string;
    description?: string;
  };
  const displayName = (() => {
    try {
      const html = readFileSync(join(ROOT, "index.html"), "utf8");
      const m = html.match(/<title>([^<]+)<\/title>/);
      return m?.[1]?.trim() || simPrefix;
    } catch {
      return simPrefix;
    }
  })();
  const first = screens[0];
  if (!first) {
    return;
  }

  const screenRows = screens
    .map(
      (s) =>
        `| \`src/${s.kebab}/${s.pascal}Screen.ts\` | Screen wrapper |\n` +
        `| \`src/${s.kebab}/model/${s.pascal}Model.ts\` | Simulation state and logic |\n` +
        `| \`src/${s.kebab}/view/${s.pascal}ScreenView.ts\` | Visual nodes, layout, a11y wiring |`,
    )
    .join("\n");

  const starterRows = [
    args.withControlOptions
      ? `| \`src/common/${simPrefix}ControlOptions.ts\` | Shared checkbox / slider / NumberControl options |\n`
      : "",
    args.withTimeModel
      ? "| `src/common/TimeModel.ts` | Play/pause, speed, and elapsed time composed by screen models |\n"
      : "",
  ].join("");

  const agents = `# AGENTS.md — ${displayName}

Sim-specific context for AI assistants. General SceneryStack guidance: [OpenLyceum/.github/AGENTS.md](https://github.com/OpenLyceum/.github/blob/main/AGENTS.md).

## Project

${displayName} (\`${pkg.name ?? ""}\`) is a SceneryStack simulation scaffolded from SceneryStackTemplate.

## Key files

| File | Purpose |
|---|---|
| \`src/${simPrefix}Colors.ts\` | All \`ProfileColorProperty\` instances |
| \`src/${simPrefix}Constants.ts\` | Named numeric constants |
| \`src/${simPrefix}Namespace.ts\` | Namespace for color property names |
| \`src/i18n/StringManager.ts\` | Singleton localized string accessor |
| \`src/common/${simPrefix}Panel.ts\` | Pre-themed \`Panel\` wrapper |
| \`src/common/${simPrefix}ButtonOptions.ts\` | Flat button / combo-box option bundles |
${starterRows}${screenRows}

## Compliance carve-outs

None yet.
`;
  writeFileSync(join(ROOT, "AGENTS.md"), agents, "utf8");
  console.log("  wrote    AGENTS.md");

  mkdirSync(join(ROOT, "doc"), { recursive: true });
  writeFileSync(
    join(ROOT, "doc", "model.md"),
    `# Model — ${displayName}

Educator-facing description of what this simulation models.

## Overview

*Describe the phenomenon and the ideas a student should take away.*

## Quantities and units

| Quantity | Symbol | Units | Range |
|---|---|---|---|
| *(fill in)* | | | |

## Governing equations

*State the equations or rules that drive the model.*

## Simplifications

*List intentional idealizations relative to the real system.*
`,
    "utf8",
  );
  console.log("  wrote    doc/model.md");

  const screenList = screens.map((s) => `src/${s.kebab}/`).join(", ");
  writeFileSync(
    join(ROOT, "doc", "implementation-notes.md"),
    `# Implementation notes — ${displayName}

Developer-facing architecture notes for \`${pkg.name ?? displayName}\`.

## Architecture

Screens: ${screenList}

- Models own state and \`step\` / \`reset\`; views observe Properties and never integrate physics.
- Colors live in \`src/${simPrefix}Colors.ts\`; strings in \`src/i18n/\` via \`StringManager\`.
- Preferences shell: \`src/preferences/\` (empty until sim-specific prefs are added).

## Notes

*Record design decisions, performance constraints, and known limitations here.*
`,
    "utf8",
  );
  console.log("  wrote    doc/implementation-notes.md");

  sanitizeForkReadme(pkg.description);
}

/** Drop one-shot template script rows from the fork README after scaffold. */
function sanitizeForkReadme(description: string | undefined): void {
  const path = join(ROOT, "README.md");
  if (!existsSync(path)) {
    return;
  }
  let text = readFileSync(path, "utf8");
  const original = text;
  const intro = description && !description.startsWith("A SceneryStack simulation:") ? description.trim() : "";
  text = text.replace(/^A reusable SceneryStack simulation template[^\n]*\n[^\n]*\n\n/m, () =>
    intro ? `${intro}\n\n` : "",
  );
  text = text.replace(/^- SceneryStack scaffold with model\/view separation[^\n]*\n/gm, "");
  text = text.replace(/^\| `npm run rename` \|.*\|\n/gm, "");
  text = text.replace(/^\| `npm run scaffold-screens` \|.*\|\n/gm, "");
  text = text.replace(/\nNew sims start at `version: "0\.0\.0"`[\s\S]*?from `package\.json`\.\n/, "\n");
  if (text !== original) {
    writeFileSync(path, text, "utf8");
    console.log("  updated  README.md (removed one-shot template scripts)");
  }
}

/**
 * Compose SharedModel into each screen model (fleet style — not injected from main).
 */
function wireSharedModel(screens: ScreenSpec[]): void {
  for (const screen of screens) {
    const modelPath = join(SRC, screen.kebab, "model", `${screen.pascal}Model.ts`);
    let model = readFileSync(modelPath, "utf8");
    if (model.includes("SharedModel")) {
      continue;
    }

    model = model.replace(
      /import type \{ TModel \} from "scenerystack\/joist";\n/,
      `import type { TModel } from "scenerystack/joist";\nimport { SharedModel } from "../../common/model/SharedModel.js";\n`,
    );
    model = model.replace(
      new RegExp(`export class ${screen.pascal}Model implements TModel \\{\\n`),
      `export class ${screen.pascal}Model implements TModel {\n` +
        `  /** Shared helpers — rename SharedModel to a domain type when known. */\n` +
        `  public readonly shared = new SharedModel();\n\n`,
    );
    if (model.includes("public reset(): void {") && !model.includes("this.shared.reset()")) {
      model = model.replace(/public reset\(\): void \{\n/, "public reset(): void {\n    this.shared.reset();\n");
    }
    writeFileSync(modelPath, model, "utf8");
    console.log(`  updated  ${relative(ROOT, modelPath)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = readArgs();
  const screenList = parseScreens(args.screens);
  if (screenList.length === 0) {
    console.error("At least one screen must be specified.");
    process.exit(1);
  }
  const prefix = detectPrefix(args.prefix);
  const sharedModel = args.sharedModel;
  const fork = !isTemplatePackage();
  const protoDir = findPrototypeDir();

  // Validate unique kebabs / keys
  const kebabs = new Set<string>();
  const keys = new Set<string>();
  for (const s of screenList) {
    if (kebabs.has(s.kebab) || keys.has(s.key)) {
      console.error(`Duplicate screen id: ${s.kebab} / ${s.key}`);
      process.exit(1);
    }
    kebabs.add(s.kebab);
    keys.add(s.key);
  }

  console.log("\nScaffolding screens:");
  for (const s of screenList) {
    console.log(`  - ${s.title}  →  src/${s.kebab}/  (${s.pascal}*, key=${s.key})`);
  }
  console.log(`  sim prefix: ${prefix}`);
  console.log(`  prototype:  ${relative(ROOT, protoDir)}`);
  console.log(`  shared model (common/model): ${sharedModel ? "yes" : "no"}`);
  console.log(`  time model: ${args.withTimeModel ? "yes" : "no (default)"}`);
  console.log(`  control options: ${args.withControlOptions ? "yes" : "no (default)"}`);
  console.log(`  strip demos / seed docs: ${fork ? "yes (fork)" : "no (live template)"}`);
  console.log("");

  for (const s of screenList) {
    emitScreenPackage(protoDir, s, prefix);
  }

  writeScreenIcons(screenList, prefix);
  updateLocaleFiles(screenList);
  updateStringManager(screenList);
  if (sharedModel) {
    writeSharedModel();
    wireSharedModel(screenList);
  }
  updateMain(screenList, prefix);
  updateSoakSuite(screenList, prefix);

  if (fork) {
    console.log("\nStripping template demos for the new seed…");
    stripDemoContent(prefix, screenList, args.withControlOptions);
    console.log("\nApplying optional starter defaults…");
    applyOptionalStarters(args, prefix, screenList);
  }

  if (fork) {
    console.log("\nWriting short sim-specific docs…");
    writeSeedDocs(prefix, screenList, args);
  } else {
    console.log("\nRewriting docs that referenced the prototype…");
    updateDocs(screenList, prefix);
  }

  console.log("\nRemoving prototype screen package…");
  rmSync(protoDir, { recursive: true, force: true });
  console.log(`  removed  ${relative(ROOT, protoDir)}`);

  console.log("\nDone.");
  console.log("\nNext steps:");
  console.log("  1. npm run fix     (emitted imports need Biome's organizeImports pass)");
  console.log("  2. npm run check");
  if (screenList.length > 1 && !fork) {
    console.log(`  3. docs now reference the ${screenList[0]?.title} screen only — tailor them for all screens`);
  }
}

main();
