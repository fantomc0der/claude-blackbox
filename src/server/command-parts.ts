import type { SummaryCommandCategory } from "../shared/types";

const sourcePrograms = new Set(["git", "gh", "glab", "hg", "svn", "jj", "tig", "git-lfs", "pre-commit"]);
const filePrograms = new Set(["ls", "dir", "cat", "head", "tail", "sed", "awk", "cut", "tr", "sort", "uniq", "wc", "tee", "find", "fd", "grep", "rg", "ag", "diff", "cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "ln", "tree", "stat", "file", "du", "df", "realpath", "basename", "dirname", "jq", "yq", "get-childitem", "gci", "get-content", "gc", "set-content", "add-content", "ac", "copy-item", "cpi", "move-item", "mi", "remove-item", "ri", "new-item", "ni", "rename-item", "rni", "test-path", "get-item", "gi", "select-string", "sls"]);
const languagePrograms = new Set(["bun", "node", "nodejs", "npm", "npx", "pnpm", "yarn", "deno", "python", "py", "pip", "pipx", "uv", "poetry", "pytest", "ruff", "dotnet", "nuget", "msbuild", "go", "cargo", "rustc", "rustup", "java", "javac", "mvn", "gradle", "ruby", "gem", "bundle", "php", "composer", "swift", "swiftc", "gcc", "g++", "clang", "clang++", "cc", "c++", "make", "cmake", "ninja"]);
const networkPrograms = new Set(["curl", "wget", "http", "https", "xh", "invoke-webrequest", "invoke-restmethod", "iwr", "irm"]);
const shellPrograms = new Set(["bash", "sh", "zsh", "fish", "dash", "cmd", "powershell", "pwsh", "eval", "source", "if", "then", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "select", "foreach", "switch", "try", "catch", "finally", "trap"]);
/** Keywords that introduce a command on the same segment: `if true`, `then ls`, `while read line`. */
const leadingKeywords = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "elseif"]);

export function commandCategory(program: string): SummaryCommandCategory {
  const name = program.toLowerCase();
  if (!name) return "other";
  if (sourcePrograms.has(name)) return "source";
  if (filePrograms.has(name)) return "files";
  if (languagePrograms.has(name) || /^(?:python|pip)\d+(?:\.\d+)*$/.test(name)) return "language";
  return networkPrograms.has(name) ? "network" : "shell";
}

/** The program a command word names: its basename without a Windows executable suffix, or "" when it is not a plain name. */
function programName(token: string): string {
  if (/[$`*?]/.test(token)) return "";
  const program = (token.split(/[\\/]/).at(-1) ?? "").replace(/\.(?:exe|cmd|bat)$/i, "");
  return !/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(program) || shellPrograms.has(program.toLowerCase()) ? "" : program;
}

/**
 * The program of a command that makes one call, or "" when it chains, pipes, substitutes, or makes no recognizable
 * call. A newline ends the call unless a quote holds it, a backslash (a backtick in PowerShell) continues the line, or
 * a heredoc body follows it: `python -c "…"` around a multi-line script, `cat <<'EOF'` with its body, and `ls \` with
 * its options on the next line are each one call, while `cd app` and `bun test` on separate lines are two.
 */
function singleProgram(command: string, tool: string): string {
  const powershell = tool.toLowerCase() === "powershell";
  const input = command.trim().replace(/\r\n?/g, "\n").replace(/^&\s+/, "");
  const words: { raw: string; value: string }[] = [];
  let quote = "";
  let raw = "";
  let value = "";
  let heredocWord: { strip: boolean } | null = null;
  const heredocs: { delimiter: string; strip: boolean }[] = [];
  const flush = () => {
    if (!raw) return;
    if (heredocWord) heredocs.push({ delimiter: value, strip: heredocWord.strip });
    else words.push({ raw, value });
    heredocWord = null;
    raw = "";
    value = "";
  };
  const lineEnd = (from: number) => { const end = input.indexOf("\n", from); return end === -1 ? input.length : end; };
  const program = () => {
    flush();
    let first = 0;
    if (!powershell) while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[first]?.raw ?? "")) first++;
    if (powershell && !/^&\s+/.test(command.trim()) && /^["']/.test(words[first]?.raw ?? "")) return "";
    return programName(words[first]?.value ?? "");
  };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];
    if (quote !== "'" && (char === "`" && !powershell || char === "$" && /[({]/.test(next ?? ""))) return "";
    if (quote !== "'" && (char === "\\" && !powershell || char === "`" && powershell)) {
      // An escaped newline continues the line; any other escaped character is literal.
      if (next === "\n") { if (!quote) flush(); index++; continue; }
      if (next && (powershell || /[\s\\"'$;&|<>#()]/.test(next))) {
        raw += char + next;
        value += next;
        index++;
        continue;
      }
    }
    if (quote) {
      raw += char;
      if (char === quote) quote = "";
      else value += char;
      continue;
    }
    if (char === "\n") {
      flush();
      if (!heredocs.length) return "";
      // The heredoc bodies run to their delimiter lines; anything after them is another call.
      let position = index + 1;
      for (const heredoc of heredocs.splice(0)) {
        while (position < input.length) {
          const end = lineEnd(position);
          const body = input.slice(position, end);
          position = end + 1;
          if ((heredoc.strip ? body.replace(/^\t+/, "") : body) === heredoc.delimiter) break;
        }
      }
      return input.slice(position).trim() ? "" : program();
    }
    if (char === "'" || char === '"') {
      if (powershell && raw === "@") {
        // A here-string runs to the line that closes it and is opaque.
        const close = input.indexOf(`\n${char}@`, index + 1);
        if (close === -1) return "";
        raw += `${char}…${char}@`;
        value += "…";
        index = close + 2;
        continue;
      }
      quote = char;
      raw += char;
    } else if (char === "#" && !raw) {
      index = lineEnd(index) - 1;
    } else if (/[;&|(){}]/.test(char)) {
      return "";
    } else if (char === "<" || char === ">") {
      if (next === "(") return "";
      if (![...words, { raw, value }].some(word => word.raw && !/^\d+$/.test(word.raw) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.raw))) return "";
      if (/^\d+$/.test(raw)) { raw = ""; value = ""; }
      flush();
      if (char === "<" && next === "<") {
        // A here-string's word is an ordinary argument; a heredoc's names the delimiter of the body that follows the line.
        if (input[index + 2] === "<") { index += 2; continue; }
        heredocWord = { strip: input[index + 2] === "-" };
        index += heredocWord.strip ? 2 : 1;
        continue;
      }
      if (next === char) index++;
      if (input[index + 1] === "&") {
        const redirect = /^[0-9-]+/.exec(input.slice(index + 2));
        if (!redirect) return "";
        index += 1 + redirect[0].length;
      }
    } else if (/\s/.test(char)) {
      flush();
    } else {
      raw += char;
      value += char;
    }
  }
  if (quote) return "";
  return program();
}

export function commandParts(command: string, tool = "Bash"): { program: string; head: string; lines: number } {
  const text = command.trim();
  const lines = text.split(/\r\n?|\n/).filter(line => line.trim());
  const head = lines[0]?.trim() ?? "";
  return { program: singleProgram(text, tool), head: head.length > 200 ? `${head.slice(0, 199)}…` : head, lines: lines.length };
}

/** One top-level program call in a chained or multiline command, as `commandSteps()` finds it. */
export interface CommandStep {
  program: string;
  /** The call's text from its program to the end of its line, after "…" when the line has text before the program. */
  head: string;
  /** The 1-based number of the call's line among the command's non-empty lines. */
  line: number;
  /** The call's 1-based position among the top-level calls on its line, and their count. */
  step: number;
  steps: number;
  /** Whether the call reads an earlier call's output through a pipe. */
  consumer: boolean;
}

interface Segment { words: { raw: string; value: string; start: number; dynamic: boolean }[]; line: number; consumer: boolean; callStart: number; redirectFirst: boolean; open: boolean }

/**
 * The top-level program calls of a command, in order: the segments that `&&`, `||`, `;`, `&`, `|`, newlines, and
 * grouping separate, each read like `commandParts()` reads a single command. Command substitutions, process
 * substitutions, heredoc and here-string bodies, comments, block comments, and PowerShell expressions are
 * opaque, so a call inside them is never a step, and a segment whose program is dynamic, quoted in PowerShell,
 * redirected before any program, or left unterminated has none. Nothing is executed, expanded, or resolved.
 */
export function commandSteps(command: string, tool = "Bash"): CommandStep[] {
  const text = command.replace(/\r\n?/g, "\n");
  const powershell = tool.toLowerCase() === "powershell";
  const segments: Segment[] = [];
  const segment = (consumer: boolean): Segment => ({ words: [], line: 0, consumer, callStart: -1, redirectFirst: false, open: false });
  let current = segment(false);
  let line = 0;
  let quote = "";
  let raw = "";
  let value = "";
  let start = -1;
  let dynamic = false;
  let heredocWord: { strip: boolean } | null = null;
  const heredocs: { delimiter: string; strip: boolean }[] = [];
  let redirectTarget = false;
  const lineEnd = (from: number) => { const end = text.indexOf("\n", from); return end === -1 ? text.length : end; };
  const flush = () => {
    if (raw) {
      if (heredocWord) heredocs.push({ delimiter: value, strip: heredocWord.strip });
      else if (!redirectTarget) current.words.push({ raw, value, start, dynamic });
      heredocWord = null;
      redirectTarget = false;
    }
    raw = "";
    value = "";
    start = -1;
    dynamic = false;
  };
  const end = (consumer: boolean) => {
    flush();
    if (current.words.length || current.callStart !== -1) segments.push(current);
    current = segment(consumer);
  };
  const add = (char: string, literal = char) => {
    if (start === -1) start = index;
    if (!current.words.length && !raw) current.line = line;
    raw += char;
    value += literal;
  };
  // Skips a nested construct from `index` (its opening character) to its closing character, which may be the end of
  // the text, counting the lines it spans.
  const skipNested = (open: string, close: string) => {
    let depth = 0;
    let inner = "";
    for (; index < text.length; index++) {
      const char = text[index];
      if (char === "\n") line++;
      if (inner) {
        if (char === "\\" && inner === '"') index++;
        else if (char === inner) inner = "";
      } else if (!powershell && char === "\\") index++;
      else if (char === "'" || char === '"') inner = char;
      else if (char === open) depth++;
      else if (char === close && --depth === 0) return;
    }
    index = text.length;
    current.open = true;
  };
  const skipUntil = (marker: string, from = index) => {
    const at = text.indexOf(marker, from);
    for (let position = index; position < (at === -1 ? text.length : at + marker.length); position++) if (text[position] === "\n") line++;
    index = at === -1 ? text.length : at + marker.length - 1;
  };
  let index = 0;
  for (; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1] ?? "";
    if (quote) {
      if (char === "\n") line++;
      if (char === quote) quote = "";
      else if (!powershell && quote === '"' && char === "\\" && /[\\"$`\n]/.test(next)) { add(char + next, next === "\n" ? "" : next); index++; if (next === "\n") line++; }
      else if (powershell && quote === '"' && char === "`" && next) { add(char + next, next); index++; if (next === "\n") line++; }
      else if (quote !== "'" && (char === "`" && !powershell || char === "$" && /[({]/.test(next))) { dynamic = true; add(char); if (char === "$") { index++; skipNested(next, next === "(" ? ")" : "}"); } else skipUntil("`", index + 1); }
      else if (quote === '"' && char === "$") { dynamic = true; add(char); }
      else add(char);
      continue;
    }
    if (char === "\n") {
      end(false);
      line++;
      if (heredocs.length) {
        let position = index + 1;
        for (const heredoc of heredocs.splice(0)) {
          while (position < text.length) {
            const stop = lineEnd(position);
            const body = text.slice(position, stop);
            position = stop + 1;
            line++;
            if ((heredoc.strip ? body.replace(/^\t+/, "") : body) === heredoc.delimiter) break;
          }
        }
        index = Math.min(position, text.length) - 1;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      if (powershell && raw === "@") { skipUntil(`\n${char}@`); add(char + "…" + char + "@"); continue; }
      quote = char;
      add(char, "");
      continue;
    }
    if (!powershell && char === "\\") {
      if (next === "\n") { flush(); index++; line++; } else if (next) { add(char + next, next); index++; } else add(char);
      continue;
    }
    if (powershell && char === "`") {
      if (next === "\n") { flush(); index++; line++; } else if (next) { add(char + next, next); index++; } else add(char);
      continue;
    }
    if (char === "#" && !raw) {
      flush();
      skipUntil("\n");
      index--;
      continue;
    }
    if (powershell && char === "<" && next === "#") { skipUntil("#>"); continue; }
    if (char === "$") {
      dynamic = true;
      if (/[({]/.test(next)) { add(char); index++; skipNested(next, next === "(" ? ")" : "}"); } else add(char);
      continue;
    }
    if (char === "`") { dynamic = true; add(char); skipUntil("`", index + 1); continue; }
    if (powershell && char === "-" && next === "-" && text[index + 2] === "%") { flush(); skipUntil("\n"); index--; continue; }
    if (powershell && char === "(") { dynamic = true; add(char); skipNested("(", ")"); continue; }
    if (char === "(" && (next === "(" || raw.endsWith("="))) { if (raw) { dynamic = true; add(char); } skipNested("(", ")"); continue; }
    if (char === "<" && next === "<") {
      flush();
      if (text[index + 2] === "<") { redirectTarget = true; index += 2; continue; }
      heredocWord = { strip: text[index + 2] === "-" };
      index += heredocWord.strip ? 2 : 1;
      continue;
    }
    if ((char === "<" || char === ">") && next === "(") { flush(); index++; skipNested("(", ")"); continue; }
    if (char === "<" || char === ">") {
      if (/^\d+$/.test(raw)) { raw = ""; value = ""; start = -1; }
      flush();
      if (!current.words.some(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.raw) || powershell)) current.redirectFirst = true;
      if (next === char) index++;
      if (text[index + 1] === "&") {
        const target = /^[0-9-]*/.exec(text.slice(index + 2))![0];
        index += 1 + target.length;
        if (target) continue;
      }
      redirectTarget = true;
      continue;
    }
    if (char === "&" && next === "&" || char === "|" && next === "|") { end(false); index++; continue; }
    if (char === "|") { end(true); if (next === "&") index++; continue; }
    if (char === "&") {
      if (powershell && !raw && !current.words.length && /\s/.test(next)) { current.callStart = index; current.line = line; continue; }
      end(false);
      continue;
    }
    if (char === ";" || char === ")" || char === "(" || char === "}" && !raw || char === "{" && !raw && /^\s*$/.test(next)) { end(false); continue; }
    if (/\s/.test(char)) flush();
    else add(char);
  }
  if (quote) current.open = true;
  end(false);

  // The program of each segment, read as `commandParts()` reads a single command; the segments on a line are counted
  // together so a step can say where it sits on the line.
  const lines = text.split("\n");
  let filled = 0;
  const numbered = lines.map(content => content.trim() ? ++filled : filled || 1);
  const calls = segments.map(entry => {
    let words = entry.words;
    if (!powershell) while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]?.raw ?? "")) words = words.slice(1);
    while (words.length && leadingKeywords.has(words[0].value.toLowerCase())) words = words.slice(1);
    const first = words[0];
    if (!first) return null;
    const quoted = /^["']/.test(first.raw);
    const called = entry.callStart !== -1 && first === entry.words[0];
    const program = entry.open || entry.redirectFirst || first.dynamic || powershell && quoted && !called ? "" : programName(first.value);
    return { entry, program, start: called ? entry.callStart : first.start };
  }).filter(call => call !== null);
  const perLine = new Map<number, number>();
  for (const call of calls) perLine.set(call.entry.line, (perLine.get(call.entry.line) ?? 0) + 1);
  const counted = new Map<number, number>();
  const steps: CommandStep[] = [];
  for (const call of calls) {
    const position = (counted.get(call.entry.line) ?? 0) + 1;
    counted.set(call.entry.line, position);
    if (!call.program) continue;
    const before = text.slice(text.lastIndexOf("\n", call.start - 1) + 1, call.start);
    const head = `${before.trim() ? "…" : ""}${text.slice(call.start, lineEnd(call.start)).trim()}`;
    steps.push({ program: call.program, head: head.length > 200 ? `${head.slice(0, 199)}…` : head, line: numbered[call.entry.line] ?? 1, step: position, steps: perLine.get(call.entry.line) ?? 1, consumer: call.entry.consumer });
  }
  return steps;
}
