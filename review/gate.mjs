#!/usr/bin/env node
// Deterministic merge gate for this repo (docs/review-standard.md, "Жорсткі обмеження").
// Runs WITHOUT any AI: its verdict cannot be argued with, only fixed.
//
//   node review/gate.mjs review-queue/pr-N/change.diff   # review a diff against app/ in the index (= HEAD)
//   node review/gate.mjs --staged                        # pre-commit: staged changes + repo guardrails
//
// Applies the change to a temp copy of the index, so app/ in the working tree is never touched.
// NOT a sandbox: G1 runs the PR's own test code with your privileges.
// Last line is always "GATE PASSED …" or "GATE BLOCKED …".
// Exit 0 = no BLOCK (WARNs allowed), 1 = blocked, 2 = gate itself failed (also prints GATE BLOCKED).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// --- diff parsing ------------------------------------------------------------

/** Unified diff → Map(path → { added: [{ line, text }], removed: [text] }). */
export function parseDiff(diff) {
  const files = new Map();
  let cur = null;
  let newLine = 0;
  let oldPath = null;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) { cur = null; oldPath = null; continue; }
    if (raw.startsWith("--- ")) { oldPath = raw.slice(4).replace(/^a\//, ""); continue; }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).replace(/^b\//, "");
      const path = p === "/dev/null" ? oldPath : p;
      cur = files.get(path) ?? { added: [], removed: [] };
      files.set(path, cur);
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (!cur) continue;
    if (raw.startsWith("+")) cur.added.push({ line: newLine++, text: raw.slice(1) });
    else if (raw.startsWith("-")) cur.removed.push(raw.slice(1));
    else if (raw.startsWith(" ")) newLine++;
  }
  return files;
}

// --- helpers -----------------------------------------------------------------

const isSrc = (p) => /^app\/src\/.*\.js$/.test(p);
const isTest = (p) => /^app\/test\//.test(p);
const codePart = (t) => t.replace(/\/\/.*$/, "").replace(/^\s*(\*|\/\*).*$/, ""); // drop comments

const EXPORT_FN = /^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;
const HELPER_FN = /^(?:async\s+)?function\s+(\w+)|^(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/;

/** Top-level functions of a module: { name, params, exported, returns, body, code (comments stripped) }. */
// ponytail: body = text up to the next column-0 declaration. Good enough for this codebase's
// formatting; switch to a parser if it grows.
export function topLevelFunctions(source) {
  const out = [];
  for (const chunk of source.split(/\n(?=(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s)/)) {
    const code = chunk.split("\n").map(codePart).join("\n");
    const m = chunk.match(EXPORT_FN);
    if (m) {
      const exprArrow = m[3] && !/^\s*\{/.test(chunk.slice(m.index + m[0].length)); // (db, user) => db.loans
      out.push({ name: m[1] ?? m[3], params: (m[2] ?? m[4]).split(",").map((s) => s.trim()), exported: true,
        returns: Boolean(exprArrow) || /\breturn\s+[^;\s]/.test(code), body: chunk, code });
      continue;
    }
    const h = chunk.match(HELPER_FN);
    if (h) out.push({ name: h[1] ?? h[2], params: [], exported: false, returns: true, body: chunk, code });
  }
  return out;
}
export const exportedFunctions = (source) => topLevelFunctions(source).filter((f) => f.exported);

/** Conventions §8: an added test line that only proves "something came back". */
export function isWeakAssertion(line) {
  // assert(x) / assert.ok(x) / assert.not*(x, <empty>) — anything else (equal, deepEqual, throws…) pins a value
  const m = line.match(/\bassert(?:\.(ok|notEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual))?\s*\((.*)\)\s*;?\s*$/);
  if (!m) return false;
  const [, fn, args] = m;
  // "is not nothing": only rules out one empty value, every other result passes
  if (fn?.startsWith("not")) return /,\s*(undefined|null|0|""|''|\[\]|\{\})\s*$/.test(args);
  // bare truthiness (assert.ok(rows)) or "non-empty" (length > 0, !== undefined)
  return /^\s*[\w$.?[\]]+\s*$/.test(args) || /\.length\s*(>\s*0|>=\s*1|!==?\s*0)\b|!==?\s*(undefined|null)\b/.test(args);
}

// --- checks ------------------------------------------------------------------
// Each check: ({ files, tree, mode }) → [{ level: "BLOCK"|"WARN", id, where, msg }]
// files = parsed diff, tree = Map(path → content) of the repo AFTER the change.

// Phrases only a tool/reviewer would be the audience for. Kept narrow on purpose: everyday
// comments ("role already checked above", "do not report returned loans") must pass.
const TOOL_ADDRESSED =
  /\b(ai|llm|gpt|chatgpt|claude|copilot|coderabbit|reviewers?|code[- ]review)\b|рев.?ю|схвал|вже\s+(перевірен|затверджен)|ignore (all |any )?(previous|prior|above)|disregard (the|all|any|previous)|\blgtm\b|approved?\s+(this|the)\s+(pr|change|diff)|pre-?approved|already\s+(been\s+)?(reviewed|approved|audited)|do not (flag|review)|no need to review|safe to merge|you are (an?|the) |eslint-disable|@ts-(ignore|nocheck|expect-error)|(istanbul|c8|coverage) ignore|\bnosec\b|\bnoqa\b|NOSONAR/i;
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u061C\uFEFF\u{E0000}-\u{E007F}]/u;
const SECRET =
  /sk-ant-[\w-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abprs]-[\w-]{10,}/;
const MONEY_WORDS = new Set(["fee", "fees", "price", "amount", "cost", "fine", "fines", "balance", "debt", "deposit", "charge", "penalty"]);
// object keys only (after `{` / `,` / line start, optionally quoted) — not `cond ? fee : 0`
const OBJECT_KEY = /(?:^|[{,])\s*["']?([A-Za-z_$][\w$]*)["']?\s*:(?!:)/g;
const isMoneyKey = (k) => k.split(/(?=[A-Z])|_/).some((w) => MONEY_WORDS.has(w.toLowerCase()));
const GATED = /requireRole\(|isStaff\(|AccessDenied|if\s*\(\s*!user\s*\)/;

export const CHECKS = {
  // G2 — no npm dependencies; imports are node: builtins or relative
  G2(ctx) {
    const out = [];
    const pkg = ctx.tree.get("app/package.json");
    if (pkg) {
      let j = {};
      try { j = JSON.parse(pkg); }
      catch { out.push({ level: "BLOCK", id: "G2", where: "app/package.json", msg: "not valid JSON" }); }
      for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
        if (j[k] && Object.keys(j[k]).length) out.push({ level: "BLOCK", id: "G2", where: "app/package.json", msg: `${k} added — app/ has no npm dependencies` });
    }
    for (const [p, src] of ctx.tree) {
      if (!/^app\/.*\.(m?js)$/.test(p)) continue;
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g))
        if (!m[1].startsWith("node:") && !m[1].startsWith(".")) out.push({ level: "BLOCK", id: "G2", where: p, msg: `import "${m[1]}" — only node: builtins or relative paths` });
    }
    return out;
  },

  // G3 — exported API changed ⇒ app/CHANGELOG.md changed in the same diff
  G3(ctx) {
    const changed = [...ctx.files].filter(([p, f]) => isSrc(p) && [...f.added.map((a) => a.text), ...f.removed].some((t) => /^\s*export\s/.test(t)));
    const log = ctx.files.get("app/CHANGELOG.md");
    if (!changed.length || log?.added.some((a) => a.text.trim())) return [];
    return changed.map(([p]) => ({ level: "BLOCK", id: "G3", where: p, msg: "exported API changed but app/CHANGELOG.md has no entry in this diff" }));
  },

  // G4 — every exported (db, …) function that returns data gates on the user/role
  G4(ctx) {
    const out = [];
    for (const [p, src] of ctx.tree) {
      if (!isSrc(p)) continue;
      for (const fn of exportedFunctions(src))
        if (fn.params[0] === "db" && fn.returns && !GATED.test(fn.code))
          out.push({ level: "BLOCK", id: "G4", where: `${p} ${fn.name}()`, msg: "takes db but never checks the caller (requireRole / isStaff / AccessDenied)" });
    }
    return out;
  },

  // G5 — email/phone ⇒ logAccess; member records are projected, never spread
  G5(ctx) {
    const out = [];
    for (const [p, src] of ctx.tree) {
      if (!isSrc(p) || p.endsWith("/db.js")) continue;
      const fns = topLevelFunctions(src);
      // helpers that build email/phone objects taint every export that calls them
      const piiHelpers = fns.filter((f) => !f.exported && /\b(email|phone)\b/.test(f.code)).map((f) => f.name);
      for (const fn of fns.filter((f) => f.exported)) {
        const { code } = fn;
        const touchesPii = /\b(email|phone)\b/.test(code) || piiHelpers.some((h) => code.includes(`${h}(`) || new RegExp(`\\b${h}\\b`).test(code));
        if (touchesPii && !/logAccess\(/.test(code))
          out.push({ level: "BLOCK", id: "G5", where: `${p} ${fn.name}()`, msg: "touches email/phone without logAccess(db, user, memberId, purpose)" });
        // ponytail: any spread in a function that reads members — may hit a harmless spread; rewrite as explicit fields
        if (/db\.members|findMember\(/.test(code) && /\.\.\.\s*[A-Za-z_]/.test(code))
          out.push({ level: "BLOCK", id: "G5", where: `${p} ${fn.name}()`, msg: "spreads an object in a function that reads members — return explicit fields (PII leak risk)" });
      }
    }
    return out;
  },

  // G6 — money only as integer kopecks; no formatting in src/
  G6(ctx) {
    const out = [];
    for (const [p, f] of ctx.files) {
      if (!isSrc(p)) continue;
      for (const { line, text } of f.added) {
        const c = codePart(text);
        if (/toFixed\(|Intl\.NumberFormat|toLocaleString\(|["'`][^"'`]*(грн|UAH|₴|hrn)/i.test(c) || /(kopecks\w*|fee\w*\([^)]*\))\s*\/\s*100\b/i.test(c))
          out.push({ level: "BLOCK", id: "G6", where: `${p}:${line}`, msg: "money formatted/converted in src/ — return integer …Kopecks, the client formats" });
        for (const m of c.matchAll(OBJECT_KEY))
          if (isMoneyKey(m[1]) && !/Kopecks$/.test(m[1])) out.push({ level: "BLOCK", id: "G6", where: `${p}:${line}`, msg: `money field "${m[1]}" must be integer kopecks named …Kopecks` });
      }
    }
    return out;
  },

  // G7 — dates: no clock reads, no local-time APIs; WARN on hand-rolled day math
  G7(ctx) {
    const out = [];
    for (const [p, f] of ctx.files) {
      if (!isSrc(p) || p.endsWith("/audit.js")) continue;
      for (const { line, text } of f.added) {
        const c = codePart(text);
        if (/new\s+Date\(\s*\)|Date\.now\(/.test(c))
          out.push({ level: "BLOCK", id: "G7", where: `${p}:${line}`, msg: "reads the clock — take today as a YYYY-MM-DD parameter (todayIso)" });
        if (/\.(get|set)(Date|Day|Month|FullYear|Hours|Minutes)\(|toLocale(Date|Time)String\(|getTimezoneOffset\(/.test(c))
          out.push({ level: "BLOCK", id: "G7", where: `${p}:${line}`, msg: "local-time date API — compute in UTC on YYYY-MM-DD strings" });
        if (/86_?400_?000|24\s*\*\s*60\s*\*\s*60/.test(c))
          out.push({ level: "WARN", id: "G7", where: `${p}:${line}`, msg: "hand-rolled day math — reuse daysBetween()/addDays() from loans.js" });
      }
    }
    return out;
  },

  // G8 — tests are not weakened
  G8(ctx) {
    const out = [];
    let removed = 0, added = 0;
    for (const [p, f] of ctx.files) {
      if (!isTest(p)) continue;
      const isAssert = (t) => /\bassert\b/.test(t) && !/^\s*import\b/.test(t);
      removed += f.removed.filter(isAssert).length;
      added += f.added.filter((a) => isAssert(a.text)).length;
      for (const { line, text } of f.added) {
        if (/\b(test|it|describe|suite)\.(skip|only|todo)\(|\{\s*(skip|only|todo)\s*:/.test(text))
          out.push({ level: "BLOCK", id: "G8", where: `${p}:${line}`, msg: "skipped/only/todo test" });
        if (isWeakAssertion(codePart(text)))
          out.push({ level: "BLOCK", id: "G8", where: `${p}:${line}`, msg: "assertion proves nothing concrete — pin the expected value" });
      }
    }
    if (removed > added) out.push({ level: "BLOCK", id: "G8", where: "app/test", msg: `net ${removed - added} assertion line(s) removed — don't weaken tests, find out why they fail` });
    return out;
  },

  // G9 — a NEW gated function has a test where access is denied
  G9(ctx) {
    const out = [];
    // one chunk per test(...) / it(...) call, nested in describe() or not; chunk 0 (imports) is dropped
    const tests = [...ctx.tree].filter(([p]) => isTest(p)).flatMap(([, s]) => ("\n" + s).split(/\n(?=\s*(?:test|it)\s*\()/).slice(1));
    for (const [p, f] of ctx.files) {
      if (!isSrc(p)) continue;
      const removedNames = new Set(f.removed.map((t) => t.match(EXPORT_FN)).filter(Boolean).map((m) => m[1] ?? m[3]));
      for (const { text } of f.added) {
        const m = text.match(EXPORT_FN);
        const name = m && (m[1] ?? m[3]);
        if (!name || removedNames.has(name)) continue;
        const fn = exportedFunctions(ctx.tree.get(p) ?? "").find((x) => x.name === name);
        if (!fn || !GATED.test(fn.code)) continue;
        if (!tests.some((t) => t.includes(`${name}(`) && /AccessDenied|user required|denied|403/.test(t)))
          out.push({ level: "BLOCK", id: "G9", where: `${p} ${name}()`, msg: "new function with an access check has no test where access is denied" });
      }
    }
    return out;
  },

  // G10 — no text aimed at tools/reviewers, no hidden characters (conventions §11)
  G10(ctx) {
    const out = [];
    for (const [p, f] of ctx.files) {
      if (!p.startsWith("app/")) continue;
      for (const { line, text } of f.added) {
        if (HIDDEN_CHARS.test(text)) out.push({ level: "BLOCK", id: "G10", where: `${p}:${line}`, msg: "invisible/bidi unicode character" });
        else if (TOOL_ADDRESSED.test(text)) out.push({ level: "BLOCK", id: "G10", where: `${p}:${line}`, msg: `text addressed to tools/reviewers: ${JSON.stringify(text.trim().slice(0, 80))}` });
      }
    }
    return out;
  },

  // G11 — filesystem access in src/ needs a containment check (conventions §3)
  G11(ctx) {
    const out = [];
    for (const [p, src] of ctx.tree) {
      if (!isSrc(p) || !/from\s+["'](node:)?fs(\/promises)?["']/.test(src)) continue;
      if (!(/startsWith\(/.test(src) && /(?<!Promise\.)\b(resolve|relative)\(/.test(src)))
        out.push({ level: "BLOCK", id: "G11", where: p, msg: "uses fs without path.resolve + startsWith containment check against the allowed dir" });
    }
    return out;
  },

  // G12 — roles come from auth.js, not string literals
  G12(ctx) {
    const out = [];
    for (const [p, f] of ctx.files) {
      if (!isSrc(p) || /\/(auth|db)\.js$/.test(p)) continue;
      for (const { line, text } of f.added) {
        const c = codePart(text);
        if (/["'](librarian|admin|member)["']|\.role\s*[!=]==?/.test(c))
          out.push({ level: "BLOCK", id: "G12", where: `${p}:${line}`, msg: "hard-coded role — use requireRole/isStaff/STAFF (add a constant to auth.js if needed)" });
      }
    }
    return out;
  },

  // G13 — no secrets anywhere in the diff
  G13(ctx) {
    const out = [];
    for (const [p, f] of ctx.files) {
      if (/(^|\/)\.env(\.|$)/.test(p)) out.push({ level: "BLOCK", id: "G13", where: p, msg: ".env file" });
      for (const { line, text } of f.added)
        if (SECRET.test(text)) out.push({ level: "BLOCK", id: "G13", where: `${p}:${line}`, msg: "looks like a credential" });
    }
    return out;
  },

  // G14 — homework repo guardrails (only for commits to this repo, i.e. --staged)
  G14(ctx) {
    if (ctx.mode !== "staged") return [];
    const out = [];
    for (const p of ctx.files.keys()) {
      if (p.startsWith("app/")) out.push({ level: "BLOCK", id: "G14", where: p, msg: "app/ is read-only here — never commit a queued diff" });
      if (/answers|answer-key/i.test(p)) out.push({ level: "BLOCK", id: "G14", where: p, msg: "answer key must never enter this repo" });
      if (p.startsWith(".github/workflows/")) out.push({ level: "BLOCK", id: "G14", where: p, msg: "workflow belongs in pipeline/, not .github/workflows/" });
    }
    return out;
  },
};

// --- runner ------------------------------------------------------------------

function readTree(root) {
  const tree = new Map();
  for (const rel of readdirSync(join(root, "app"), { recursive: true })) {
    const p = `app/${rel.split("\\").join("/")}`;
    if (/\.(m?js|json|md)$/.test(p) && !p.includes("node_modules")) tree.set(p, readFileSync(join(root, p), "utf8"));
  }
  return tree;
}

function main(argv) {
  const staged = argv[0] === "--staged";
  if (!staged && !argv[0]) { console.error("usage: node review/gate.mjs <change.diff> | --staged"); return 2; }

  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });
  const repo = git("rev-parse", "--show-toplevel").trim();
  // fixed a/ b/ prefixes and no rename detection, whatever the user's git config says
  const diff = staged
    ? git("-C", repo, "diff", "--cached", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/")
    : readFileSync(argv[0], "utf8");
  const tmp = mkdtempSync(join(tmpdir(), "gate-"));
  const report = [];
  try {
    // Index snapshot: for --staged it IS the change; for a diff it's the base we apply onto.
    git("-C", repo, "checkout-index", "-a", "-f", `--prefix=${tmp}/`);
    if (!staged && diff.trim()) {
      writeFileSync(join(tmp, ".change.diff"), diff);
      const ap = spawnSync("git", ["apply", "--whitespace=nowarn", ".change.diff"], { cwd: tmp, encoding: "utf8" });
      if (ap.status !== 0) {
        console.log(`BLOCK G0  diff does not apply to base app/:\n${ap.stderr.trim()}`);
        console.log("GATE BLOCKED — 1 block(s), 0 warning(s); tests: not run; checks: G0");
        return 1;
      }
    }

    // G1 — test suite on the changed tree
    const t = spawnSync(process.execPath, ["--test"], { cwd: join(tmp, "app"), encoding: "utf8", timeout: 120_000 });
    const summary = (t.stdout.match(/^ℹ (tests|pass|fail) \d+$/gm) ?? []).join(", ").replaceAll("ℹ ", "");
    if (t.status !== 0) report.push({ level: "BLOCK", id: "G1", where: "app/", msg: `node --test failed (${summary || `exit ${t.status ?? t.signal}`})\n${(t.stdout + t.stderr).split("\n").filter((l) => /✖|Error|expected|actual/.test(l)).slice(0, 15).join("\n")}` });

    const ctx = { files: parseDiff(diff), tree: readTree(tmp), mode: staged ? "staged" : "diff" };
    for (const check of Object.values(CHECKS)) report.push(...check(ctx));

    for (const r of report) console.log(`${r.level.padEnd(5)} ${r.id.padEnd(3)} ${r.where}  ${r.msg}`);
    const blocks = report.filter((r) => r.level === "BLOCK").length;
    console.log(`GATE ${blocks ? "BLOCKED" : "PASSED"} — ${blocks} block(s), ${report.length - blocks} warning(s); tests: ${summary || "n/a"}; checks: G0–G14`);
    return blocks ? 1 : 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.log(`GATE BLOCKED — gate error (fail closed): ${e.message}`); process.exitCode = 2; }
}
