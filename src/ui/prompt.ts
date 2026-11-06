import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { AGENTS } from "../kit/agents.js";
import { CancelledError, UsageError } from "../kit/errors.js";
import type { Stack } from "../kit/stacks.js";

/** A readable stream that may be a terminal (process.stdin, or a test double). */
type Input = NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };

interface Item {
  label: string;
  hint: string;
}

interface Key {
  name?: string;
  ctrl?: boolean;
}

const ESC = "\x1b[";
const color = !process.env.NO_COLOR;
const accent = (s: string) => (color ? `${ESC}36m${s}${ESC}39m` : s);
const dim = (s: string) => (color ? `${ESC}2m${s}${ESC}22m` : s);

/**
 * Interactive questions. In a real terminal the menus move with the arrow keys (raw mode, no
 * dependencies); otherwise, and for text answers, it reads whole lines through one async iterator,
 * so answers that arrive before the question is printed (pasted or piped) are never lost.
 */
export class Prompter {
  private rl: Interface | undefined;
  private lines: AsyncIterator<string> | undefined;

  constructor(private readonly input: Input, private readonly out: NodeJS.WritableStream) {}

  close(): void {
    this.rl?.close();
    this.rl = undefined;
    this.lines = undefined;
  }

  /** True when the input is a terminal that supports raw mode, so the menus can use the arrow keys. */
  private get arrows(): boolean {
    return this.input.isTTY === true && typeof this.input.setRawMode === "function";
  }

  private say(text: string): void {
    this.out.write(`${text}\n`);
  }

  /** Prints the prompt and returns the trimmed answer, or undefined when the input ended. */
  private async line(prompt: string): Promise<string | undefined> {
    if (!this.lines) {
      this.rl = createInterface({ input: this.input, terminal: false });
      this.lines = this.rl[Symbol.asyncIterator]();
    }
    this.out.write(prompt);
    const next = await this.lines.next();
    return next.done ? undefined : next.value.trim();
  }

  /**
   * Arrow-key menu: ↑/↓ (or k/j) move, a number jumps, Enter chooses; with `multi`, space toggles.
   * Returns the chosen indexes. Ctrl+C, Ctrl+D, Esc or the end of the input restore the terminal and throw CancelledError.
   */
  private select(question: string, items: Item[], multi: boolean, checked: number[] = []): Promise<number[]> {
    // The line reader would also consume the keys: it is recreated by the next text question.
    this.close();
    const input = this.input;
    const n = items.length;
    const width = Math.max(...items.map((i) => i.label.length));
    const picked = new Set(checked);
    let cursor = 0;
    let warning = "";
    const help = multi ? "↑/↓ mover · espacio marcar · Enter confirmar" : "↑/↓ mover · Enter elegir";
    const row = (i: number) => {
      const here = i === cursor;
      const box = multi ? (picked.has(i) ? "◉ " : "◯ ") : "";
      const text = `${items[i]!.label.padEnd(width)}  ${dim(items[i]!.hint)}`;
      return `${here ? accent("❯") : " "} ${box}${here ? accent(text) : text}`;
    };
    const footer = () => (warning ? `  ${warning}` : `  ${dim(help)}`);
    const draw = (again: boolean) => {
      if (again) this.out.write(`${ESC}${n + 1}A`);
      for (let i = 0; i < n; i++) this.out.write(`${ESC}2K${row(i)}\n`);
      this.out.write(`${ESC}2K${footer()}\n`);
    };

    this.say(question);
    this.out.write(`${ESC}?25l`);
    draw(false);
    emitKeypressEvents(input);
    const wasRaw = input.isRaw === true;
    input.setRawMode!(true);
    input.resume();

    return new Promise((resolve, reject) => {
      const finish = (result: number[] | Error) => {
        input.removeListener("keypress", onKey);
        input.removeListener("end", onEnd);
        input.removeListener("close", onEnd);
        input.setRawMode!(wasRaw);
        input.pause();
        this.out.write(`${ESC}?25h`);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      // A closed terminal or an ended stdin must not leave the menu waiting forever.
      const onEnd = () => finish(new CancelledError());
      const onKey = (str: string | undefined, key: Key | undefined) => {
        warning = "";
        if ((key?.ctrl && (key.name === "c" || key.name === "d")) || key?.name === "escape") return finish(new CancelledError());
        if (key?.name === "up" || key?.name === "k") cursor = (cursor - 1 + n) % n;
        else if (key?.name === "down" || key?.name === "j") cursor = (cursor + 1) % n;
        else if (multi && key?.name === "space") picked.has(cursor) ? picked.delete(cursor) : picked.add(cursor);
        else if (str && /^[1-9]$/.test(str) && Number(str) <= n) cursor = Number(str) - 1;
        else if (key?.name === "return" || key?.name === "enter") {
          if (!multi) return finish([cursor]);
          if (picked.size > 0) return finish([...picked].sort((a, b) => a - b));
          warning = "Marca al menos una (espacio).";
        }
        draw(true);
      };
      input.on("keypress", onKey);
      input.once("end", onEnd);
      input.once("close", onEnd);
    });
  }

  async stack(stacks: Stack[]): Promise<string> {
    if (this.arrows) {
      const [i] = await this.select("¿Qué stack usa el proyecto?", stacks.map((s) => ({ label: s.id, hint: s.name })), false);
      return stacks[i!]!.id;
    }
    const width = Math.max(...stacks.map((s) => s.id.length));
    this.say("¿Qué stack usa el proyecto?");
    stacks.forEach((s, i) => this.say(`  ${i + 1}) ${s.id.padEnd(width)}  ${s.name}`));
    for (;;) {
      const answer = await this.line("Número o id: ");
      if (answer === undefined) throw new UsageError("No se eligió un stack. Usa --stack <id>");
      const byNumber = /^\d+$/.test(answer) ? stacks[Number(answer) - 1] : undefined;
      const chosen = byNumber ?? stacks.find((s) => s.id === answer);
      if (chosen) return chosen.id;
      this.say(answer ? `  «${answer}» no es una opción válida.` : "  Hace falta elegir un stack.");
    }
  }

  async agents(defaults: string[]): Promise<string[]> {
    const ids = AGENTS.map((a) => a.id);
    if (this.arrows) {
      const chosen = await this.select(
        "¿Con qué herramientas vas a trabajar?",
        ids.map((id) => ({ label: id, hint: defaults.includes(id) ? "(por defecto)" : "" })),
        true,
        ids.flatMap((id, i) => (defaults.includes(id) ? [i] : [])),
      );
      return chosen.map((i) => ids[i]!);
    }
    const width = Math.max(...ids.map((id) => id.length));
    this.say("¿Con qué herramientas vas a trabajar? (puedes elegir varias, separadas por comas)");
    ids.forEach((id, i) => this.say(`  ${i + 1}) ${id.padEnd(width)}${defaults.includes(id) ? "  (por defecto)" : ""}`));
    for (;;) {
      const answer = await this.line(`Números o ids [${defaults.join(",")}]: `);
      if (!answer) return defaults;
      const tokens = answer.split(",").map((t) => t.trim()).filter(Boolean);
      const picked = tokens.map((t) => (/^\d+$/.test(t) ? ids[Number(t) - 1] : ids.find((id) => id === t)));
      const unknown = tokens.filter((_, i) => picked[i] === undefined);
      if (unknown.length === 0) return ids.filter((id) => picked.includes(id));
      this.say(`  No reconozco: ${unknown.join(", ")}. Usa los números o los ids de la lista.`);
    }
  }

  async context(): Promise<string> {
    return (await this.line("¿De qué trata el proyecto? (una o dos frases; Enter para dejarlo vacío): ")) ?? "";
  }

  /**
   * Menu of options; returns the chosen option's `id`. In a terminal it moves with the arrow keys;
   * otherwise it is numbered: Enter takes the first option, an invalid answer asks again, and the
   * end of the input fails.
   */
  async choose(question: string, options: { id: string; label: string; hint: string }[]): Promise<string> {
    if (this.arrows) {
      const [i] = await this.select(question, options, false);
      return options[i!]!.id;
    }
    const width = Math.max(...options.map((o) => o.label.length));
    this.say(question);
    options.forEach((o, i) => this.say(`  ${i + 1}) ${o.label.padEnd(width)}  ${o.hint}`));
    for (;;) {
      const answer = await this.line("Número [1]: ");
      if (answer === undefined) throw new UsageError("No se eligió ninguna opción.");
      if (answer === "") return options[0]!.id;
      const chosen = /^\d+$/.test(answer) ? options[Number(answer) - 1] : undefined;
      if (chosen) return chosen.id;
      this.say(`  «${answer}» no es una opción válida.`);
    }
  }

  /** Yes/no question; Enter (or the end of the input) takes the default. */
  async confirm(question: string, byDefault: boolean): Promise<boolean> {
    for (;;) {
      const answer = await this.line(`${question} ${byDefault ? "[S/n]" : "[s/N]"}: `);
      if (!answer) return byDefault;
      if (/^(s|si|sí|y|yes)$/i.test(answer)) return true;
      if (/^(n|no)$/i.test(answer)) return false;
      this.say("  Responde s o n.");
    }
  }
}
