import type { SummaryCommandCategory } from "../shared/types";

const languagePrograms = new Set(["bun", "node", "nodejs", "npm", "npx", "pnpm", "yarn", "deno", "python", "py", "pip", "pipx", "uv", "poetry", "pytest", "ruff", "dotnet", "nuget", "msbuild", "go", "cargo", "rustc", "rustup", "java", "javac", "mvn", "gradle", "ruby", "gem", "bundle", "php", "composer", "swift", "swiftc", "gcc", "g++", "clang", "clang++", "cc", "c++", "make", "cmake", "ninja"]);
const networkPrograms = new Set(["curl", "wget", "http", "https", "xh", "invoke-webrequest", "invoke-restmethod", "iwr", "irm"]);
const shellPrograms = new Set(["bash", "sh", "zsh", "fish", "dash", "cmd", "powershell", "pwsh", "eval", "source", "if", "then", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "select", "foreach", "switch", "try", "catch", "finally", "trap"]);

export function commandCategory(program: string): SummaryCommandCategory {
  const name = program.toLowerCase();
  if (!name) return "other";
  if (languagePrograms.has(name) || /^(?:python|pip)\d+(?:\.\d+)*$/.test(name)) return "language";
  return networkPrograms.has(name) ? "network" : "shell";
}

function singleProgram(command: string, tool: string): string {
  if (/[\r\n]/.test(command)) return "";
  const powershell = tool.toLowerCase() === "powershell";
  const input = command.trim().replace(/^&\s+/, "");
  const words: { raw: string; value: string }[] = [];
  let quote = "";
  let raw = "";
  let value = "";
  const flush = () => {
    if (raw) words.push({ raw, value });
    raw = "";
    value = "";
  };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];
    if (quote !== "'" && (char === "`" || char === "$" && /[({]/.test(next ?? ""))) return "";
    if (!powershell && char === "\\" && quote !== "'" && next && /[\s\\"'$;&|<>#()]/.test(next)) {
      raw += char + next;
      value += next;
      index++;
      continue;
    }
    if (quote) {
      raw += char;
      if (char === quote) quote = "";
      else value += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      raw += char;
    } else if (char === "#" && !raw) {
      break;
    } else if (/[;&|(){}]/.test(char)) {
      return "";
    } else if (char === "<" || char === ">") {
      if (char === "<" && next === "<" || next === "(") return "";
      if (![...words, { raw, value }].some(word => word.raw && !/^\d+$/.test(word.raw) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.raw))) return "";
      flush();
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
  flush();
  let first = 0;
  if (!powershell) while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[first]?.raw ?? "")) first++;
  const token = words[first]?.value ?? "";
  if (powershell && !/^&\s+/.test(command.trim()) && /^["']/.test(words[first]?.raw ?? "")) return "";
  if (/[$`*?]/.test(token)) return "";
  const program = (token.split(/[\\/]/).at(-1) ?? "").replace(/\.(?:exe|cmd|bat)$/i, "");
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(program) || shellPrograms.has(program.toLowerCase())) return "";
  return program;
}

export function commandParts(command: string, tool = "Bash"): { program: string; head: string; lines: number } {
  const text = command.trim();
  const lines = text.split(/\r\n?|\n/).filter(line => line.trim());
  const head = lines[0]?.trim() ?? "";
  return { program: singleProgram(text, tool), head: head.length > 200 ? `${head.slice(0, 199)}…` : head, lines: lines.length };
}
