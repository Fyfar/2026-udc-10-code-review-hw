#!/usr/bin/env node
// PreToolUse guard: an agent may not switch off or rewrite the deterministic gate.
// Exit 2 = block the tool call (stderr goes back to the model). Fails closed on bad input.
// ponytail: regex over the command text — a speed bump for agents, not a sandbox (an
// obfuscated command can still get through). The real wall is CI running review/gate.mjs
// from the BASE branch (Task D).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROTECTED = /(review\/gate|\.githooks\/|\.githooks$|\.claude\/(settings|hooks))/;
const BYPASS = [
  [/git\b[^;&|]*\s--no-v[a-z-]*/i, "--no-verify (or an abbreviation) skips the pre-commit gate"],
  [/git\b[^;&|]*\bcommit\b[^;&|]*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/, "git commit -n skips the pre-commit gate"],
  [/core\.hookspath|GIT_CONFIG_(PARAMETERS|COUNT|KEY|VALUE)/i, "changing core.hooksPath disables the gate"],
  [/git\s+(commit-tree|update-ref|replace|filter-branch|filter-repo)\b/i, "low-level ref writes bypass the gate"],
];
// command (first word of a segment) → which of its arguments it writes to
const WRITES_ALL = /^(rm|mv|ln|tee|truncate|chmod|chown|unlink|touch|install|rsync)$/;
const EVALS = /^(node|python3?|perl|ruby|sh|bash|zsh|deno|bun)$/; // code in a string: target unknowable

function deny(why) {
  process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: ${why}. The gate is not negotiable — fix the code instead.\n`);
  process.exit(2);
}

function checkSegment(seg, cwd) {
  const words = seg.trim().replace(/^(\w+=\S*\s+)+/, "").split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ""));
  const [cmd, ...args] = words;
  const hits = (ws) => ws.some((w) => PROTECTED.test(w));
  // redirects / dd into a protected path, wherever it points from (./, $PWD/, /abs/…)
  if (/(>>?|\bof=)\s*["']?[^\s"']*(review\/gate|\.githooks|\.claude\/(settings|hooks))/.test(seg)) deny("redirect into a protected file");
  if (WRITES_ALL.test(cmd) && hits(args)) deny(`${cmd} on a protected file`);
  if (cmd === "cp" && PROTECTED.test(args.filter((a) => !a.startsWith("-")).at(-1) ?? "")) deny("cp onto a protected file");
  if (/^(sed|perl)$/.test(cmd) && args.some((a) => /^-\S*i/.test(a)) && hits(args)) deny("in-place edit of a protected file");
  if (EVALS.test(cmd) && args.some((a) => /^(-e|-c|-p|--eval|--print)$/.test(a)) && PROTECTED.test(seg)) deny("inline script touching a protected file");
  if (cmd === "git" && /^(checkout|restore|rm|mv|update-index|stash)$/.test(args[0] ?? "") && hits(args)) deny(`git ${args[0]} on a protected file`);
  // a patch file may carry protected paths that the command line never mentions
  if ((cmd === "git" && args[0] === "apply") || cmd === "patch") {
    for (const a of args.filter((x) => !x.startsWith("-") && x !== "apply")) {
      const p = resolve(cwd, a);
      if (existsSync(p) && /^(\+\+\+|---) [ab]\/\S*(review\/gate|\.githooks|\.claude\/(settings|hooks))/m.test(readFileSync(p, "utf8"))) deny(`patch ${a} modifies a protected file`);
    }
  }
}

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { deny("unreadable hook input (fail closed)"); }
const t = input.tool_input ?? {};

if (input.tool_name === "Bash") {
  const cmd = t.command ?? "";
  // a lone `git config --get core.hooksPath` only reads it
  const readOnlyConfig = /^\s*git\s+config\s+(--get|--list|-l)\b/.test(cmd) && !/[;&|]/.test(cmd);
  for (const [re, why] of BYPASS) if (re.test(cmd) && !(readOnlyConfig && why.includes("core.hooksPath"))) deny(why);
  for (const seg of cmd.split(/&&|\|\||[;|\n]/)) checkSegment(seg, input.cwd ?? process.cwd());
} else if (PROTECTED.test((t.file_path ?? t.notebook_path ?? "").replaceAll("\\", "/"))) {
  deny("the gate / hooks / settings are human-only");
}
