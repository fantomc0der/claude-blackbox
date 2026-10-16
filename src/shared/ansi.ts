/**
 * Terminal escape sequences in recorded text.
 *
 * Claude Code records local command output and tool results as the terminal received them, so a string may carry
 * SGR styling such as `\x1b[1m`, cursor movement, window titles, and hyperlinks. Browsers draw the ESC character and
 * other control characters as visible boxes, so recorded text is cleaned before it reaches the DOM: SGR styling becomes
 * `TerminalStyle` runs for monospace panels and is dropped from prose, and every other sequence is removed.
 */

export interface TerminalStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
  /** A palette index 0–15, or an `rgb()` color from a 256-color or 24-bit sequence. */
  fg?: number | string;
  bg?: number | string;
}

/** A run of recorded text that shares one style; `terminal` is absent for unstyled text. */
export interface TerminalRun {
  text: string;
  terminal?: TerminalStyle;
}

// Anything below U+0020 other than tab, line feed, and carriage return, plus DEL and the C1 controls. Clean text
// skips every replacement below, so a plain string costs one scan.
const DIRTY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

// In order: a CSI sequence (parameters, intermediates, final byte), an OSC string ended by BEL or ST, a DCS, SOS, PM, or
// APC string ended by ST, and any other escape with its intermediates and final byte. String bodies are bounded so an
// unterminated string swallows nothing but its introducer, which the last alternative then matches on its own.
const SEQUENCE = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u009c]{0,4096}?(?:\u0007|\u001b\\|\u009c)|\u001b[PX^_][^\u009c]{0,4096}?(?:\u001b\\|\u009c)|\u001b[ -/]*[0-~]/g;
const SGR = /^(?:\u001b\[|\u009b)([0-9;:]*)m$/;

const STYLE_KEYS = ["bold", "dim", "italic", "underline", "strike", "inverse", "fg", "bg"] as const;

/** Removes every escape sequence and non-printing control character, keeping tabs, line feeds, and carriage returns. */
export function stripAnsi(text: string): string {
  return DIRTY.test(text) ? text.replace(SEQUENCE, "").replace(CONTROL, "") : text;
}

/**
 * Splits recorded terminal output into runs of text that share one SGR style, dropping every escape sequence and
 * control character. The runs' text concatenates to `stripAnsi(text)`.
 */
export function terminalRuns(text: string): TerminalRun[] {
  if (!DIRTY.test(text)) return text ? [{ text }] : [];
  const runs: TerminalRun[] = [];
  let style: TerminalStyle | undefined;
  // Text joins the previous run when nothing visible changed since it, so toggling a style off and on between words
  // leaves one run and a stream of resets does not fragment the output.
  const append = (raw: string) => {
    const clean = raw.replace(CONTROL, "");
    if (!clean) return;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.terminal, style)) last.text += clean;
    else runs.push(style ? { text: clean, terminal: style } : { text: clean });
  };
  let last = 0;
  for (const match of text.matchAll(SEQUENCE)) {
    append(text.slice(last, match.index));
    last = match.index + match[0].length;
    const sgr = SGR.exec(match[0]);
    if (sgr) style = applySgr(style, sgr[1]!);
  }
  append(text.slice(last));
  return runs;
}

function sameStyle(a: TerminalStyle | undefined, b: TerminalStyle | undefined): boolean {
  return STYLE_KEYS.every(key => a?.[key] === b?.[key]);
}

function applySgr(current: TerminalStyle | undefined, params: string): TerminalStyle | undefined {
  const style: TerminalStyle = { ...current };
  const codes = params.split(";");
  for (let index = 0; index < codes.length; index++) {
    const [code = "", ...sub] = codes[index]!.split(":");
    const value = code === "" ? 0 : Number(code);
    if (!Number.isInteger(value)) continue;
    if (value === 0) for (const key of STYLE_KEYS) delete style[key];
    else if (value === 1) style.bold = true;
    else if (value === 2) style.dim = true;
    else if (value === 3) style.italic = true;
    else if (value === 4 || value === 21) style.underline = true;
    else if (value === 7) style.inverse = true;
    else if (value === 9) style.strike = true;
    else if (value === 22) { delete style.bold; delete style.dim; }
    else if (value === 23) delete style.italic;
    else if (value === 24) delete style.underline;
    else if (value === 27) delete style.inverse;
    else if (value === 29) delete style.strike;
    else if (value >= 30 && value <= 37) style.fg = value - 30;
    else if (value >= 40 && value <= 47) style.bg = value - 40;
    else if (value >= 90 && value <= 97) style.fg = value - 82;
    else if (value >= 100 && value <= 107) style.bg = value - 92;
    else if (value === 39) delete style.fg;
    else if (value === 49) delete style.bg;
    else if (value === 38 || value === 48) {
      // `38;5;n`, `38;2;r;g;b`, or the colon forms `38:5:n` and `38:2::r:g:b`, whose arguments are all in `sub`.
      const { color, used } = extendedColor(sub.length ? sub : codes.slice(index + 1), sub.length > 0);
      if (!sub.length) index += used;
      if (color === undefined) continue;
      if (value === 38) style.fg = color; else style.bg = color;
    }
  }
  return STYLE_KEYS.some(key => style[key] !== undefined) ? style : undefined;
}

function channel(value: string | undefined): number | undefined {
  const number = value === undefined || value === "" ? NaN : Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 255 ? number : undefined;
}

function extendedColor(args: string[], colon: boolean): { color?: number | string; used: number } {
  if (args[0] === "5") {
    const index = channel(args[1]);
    return { color: index === undefined ? undefined : index < 16 ? index : palette(index), used: 2 };
  }
  if (args[0] === "2") {
    // The colon form may carry an empty color-space id between the `2` and the channels.
    const offset = colon && args.length >= 5 ? 2 : 1;
    const [red, green, blue] = [channel(args[offset]), channel(args[offset + 1]), channel(args[offset + 2])];
    return { color: red === undefined || green === undefined || blue === undefined ? undefined : `rgb(${red}, ${green}, ${blue})`, used: 4 };
  }
  // An unknown selector swallows itself so it is not read as a style code of its own.
  return { used: args.length ? 1 : 0 };
}

/** The xterm 256-color palette beyond the 16 named colors: a 6×6×6 cube, then 24 grays. */
function palette(index: number): string {
  if (index >= 232) { const gray = 8 + (index - 232) * 10; return `rgb(${gray}, ${gray}, ${gray})`; }
  const cube = index - 16;
  const level = (step: number) => step ? 55 + step * 40 : 0;
  return `rgb(${level(Math.floor(cube / 36))}, ${level(Math.floor(cube / 6) % 6)}, ${level(cube % 6)})`;
}
