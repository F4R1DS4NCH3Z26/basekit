import { createInterface, type Interface } from "node:readline";
import { AGENTS } from "./agents.js";
import { UsageError, type Stack } from "./templates.js";

/**
 * Interactive questions for `init`. It reads lines through one async iterator, so answers
 * that arrive before the question is printed (pasted or piped) are never lost.
 */
export class Prompter {
  private readonly rl: Interface;
  private readonly lines: AsyncIterator<string>;

  constructor(input: NodeJS.ReadableStream, private readonly out: NodeJS.WritableStream) {
    this.rl = createInterface({ input, terminal: false });
    this.lines = this.rl[Symbol.asyncIterator]();
  }

  close(): void {
    this.rl.close();
  }

  private say(text: string): void {
    this.out.write(`${text}\n`);
  }

  /** Prints the prompt and returns the trimmed answer, or undefined when the input ended. */
  private async line(prompt: string): Promise<string | undefined> {
    this.out.write(prompt);
    const next = await this.lines.next();
    return next.done ? undefined : next.value.trim();
  }

  async stack(stacks: Stack[]): Promise<string> {
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
}
