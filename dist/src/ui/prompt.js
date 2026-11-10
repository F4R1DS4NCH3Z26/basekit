import { createInterface, emitKeypressEvents } from "node:readline";
import { AGENTS } from "../kit/agents.js";
import { CancelledError, UsageError } from "../kit/errors.js";
import { SIDES } from "../kit/layout.js";
import { KINDS } from "../kit/stacks.js";
/** How the kinds of app (S1b) read in the first step of the stack question. */
const KIND_LABELS = {
    backend: { label: "Backend", hint: "API o servicio, con base de datos" },
    frontend: { label: "Frontend", hint: "SPA que corre en el navegador, sin base de datos" },
    fullstack: { label: "Fullstack", hint: "Una app integrada, o un backend y un frontend combinados" },
};
/** The extra option of the fullstack step (S16): a backend stack in backend/ plus a frontend stack in frontend/. */
const COMBINE = { label: "Combinar backend + frontend", hint: "monorepo backend/ + frontend/; make dev levanta los dos", keys: ["combinar", "combo"] };
/** The option an answer names in numbered mode: its number (from 1), its label or one of its keys, ignoring case; -1 if none. */
function optionIndex(options, answer) {
    if (/^\d+$/.test(answer)) {
        const i = Number(answer) - 1;
        return i < options.length ? i : -1;
    }
    const lower = answer.toLowerCase();
    return options.findIndex((o) => o.label.toLowerCase() === lower || o.keys.some((k) => k.toLowerCase() === lower));
}
/** `text` cut to `max` characters, with "…" when it had to be shortened. */
const cut = (text, max) => ([...text].length <= max ? text : `${[...text].slice(0, Math.max(0, max - 1)).join("")}…`);
const ESC = "\x1b[";
const color = !process.env.NO_COLOR;
const accent = (s) => (color ? `${ESC}36m${s}${ESC}39m` : s);
const dim = (s) => (color ? `${ESC}2m${s}${ESC}22m` : s);
/**
 * Interactive questions. In a real terminal the menus move with the arrow keys (raw mode, no
 * dependencies); otherwise, and for text answers, it reads whole lines through one async iterator,
 * so piped answers and lines typed before a text question are kept. Keys typed in a terminal
 * before a menu is drawn are discarded: the menu reads keys, not lines.
 */
export class Prompter {
    input;
    out;
    rl;
    lines;
    constructor(input, out) {
        this.input = input;
        this.out = out;
    }
    close() {
        this.rl?.close();
        this.rl = undefined;
        this.lines = undefined;
    }
    /** True when the input is a terminal that supports raw mode, so the menus can use the arrow keys. */
    get arrows() {
        return this.input.isTTY === true && typeof this.input.setRawMode === "function";
    }
    say(text) {
        this.out.write(`${text}\n`);
    }
    /** Prints the prompt and returns the trimmed answer, or undefined when the input ended. */
    async line(prompt) {
        if (!this.lines) {
            this.rl = createInterface({ input: this.input, terminal: false });
            this.lines = this.rl[Symbol.asyncIterator]();
        }
        this.out.write(prompt);
        const next = await this.lines.next();
        return next.done ? undefined : next.value.trim();
    }
    /**
     * Arrow-key menu: ↑/↓ (or k/j) move, 1–9 jump to that option, Enter chooses; with `multi`, space toggles.
     * Returns the chosen indexes. Ctrl+C, Ctrl+D, Esc or the end of the input restore the terminal and throw CancelledError.
     */
    select(question, items, multi, checked = []) {
        // The line reader would also consume the keys: it is recreated by the next text question.
        this.close();
        const input = this.input;
        const n = items.length;
        const width = Math.max(...items.map((i) => i.label.length));
        const picked = new Set(checked);
        let cursor = 0;
        let warning = "";
        const help = multi ? "↑/↓ mover · espacio marcar · Enter confirmar" : "↑/↓ mover · Enter elegir";
        // Every row must fit on one line: the redraw moves the cursor up one line per row.
        const columns = Math.max(20, (this.out.columns ?? 80) - 1);
        const row = (i) => {
            const here = i === cursor;
            const box = multi ? (picked.has(i) ? "◉ " : "◯ ") : "";
            const label = cut(items[i].label.padEnd(width), columns - 2 - box.length);
            const room = columns - 2 - box.length - label.length - 2;
            const hint = room > 1 ? cut(items[i].hint, room) : "";
            const text = hint ? `${label}  ${dim(hint)}` : label;
            return `${here ? accent("❯") : " "} ${box}${here ? accent(text) : text}`;
        };
        const footer = () => `  ${warning ? cut(warning, columns - 2) : dim(cut(help, columns - 2))}`;
        const draw = (again) => {
            if (again)
                this.out.write(`${ESC}${n + 1}A`);
            for (let i = 0; i < n; i++)
                this.out.write(`${ESC}2K${row(i)}\n`);
            this.out.write(`${ESC}2K${footer()}\n`);
        };
        this.say(question);
        this.out.write(`${ESC}?25l`);
        draw(false);
        emitKeypressEvents(input);
        const wasRaw = input.isRaw === true;
        input.setRawMode(true);
        input.resume();
        return new Promise((resolve, reject) => {
            const finish = (result) => {
                input.removeListener("keypress", onKey);
                input.removeListener("end", onEnd);
                input.removeListener("close", onEnd);
                input.setRawMode(wasRaw);
                input.pause();
                this.out.write(`${ESC}?25h`);
                if (result instanceof Error)
                    reject(result);
                else
                    resolve(result);
            };
            // A closed terminal or an ended stdin must not leave the menu waiting forever.
            const onEnd = () => finish(new CancelledError());
            const onKey = (str, key) => {
                warning = "";
                if ((key?.ctrl && (key.name === "c" || key.name === "d")) || key?.name === "escape")
                    return finish(new CancelledError());
                if (key?.name === "up" || key?.name === "k")
                    cursor = (cursor - 1 + n) % n;
                else if (key?.name === "down" || key?.name === "j")
                    cursor = (cursor + 1) % n;
                else if (multi && key?.name === "space")
                    picked.has(cursor) ? picked.delete(cursor) : picked.add(cursor);
                else if (str && /^[1-9]$/.test(str) && Number(str) <= n)
                    cursor = Number(str) - 1;
                else if (key?.name === "return" || key?.name === "enter") {
                    if (!multi)
                        return finish([cursor]);
                    if (picked.size > 0)
                        return finish([...picked].sort((a, b) => a - b));
                    warning = "Marca al menos una (espacio).";
                }
                draw(true);
            };
            input.on("keypress", onKey);
            input.once("end", onEnd);
            input.once("close", onEnd);
        });
    }
    /**
     * Which stack: Tipo → Lenguaje → Framework (S1b), each step filtered by the previous answers.
     * Fullstack also offers «Combinar backend + frontend» (S16): then it asks Lenguaje → Framework for the
     * backend and again for the frontend, and returns `<backend>+<frontend>`.
     * A step with a single option is chosen by itself and announced. Without a terminal it is numbered:
     * a number or a name is accepted (a stack id too, at any step), an invalid answer asks again and
     * the end of the input fails pointing at --stack.
     */
    async stack(stacks) {
        const combinable = SIDES.every((side) => stacks.some((s) => s.kind === side));
        const kinds = KINDS.filter((k) => stacks.some((s) => s.kind === k) || (k === "fullstack" && combinable));
        const kind = await this.step("Tipo", "¿Qué tipo de app es?", kinds.map((k) => ({ label: KIND_LABELS[k].label, hint: KIND_LABELS[k].hint, keys: [k] })), stacks);
        if (typeof kind === "string")
            return kind;
        const ofKind = stacks.filter((s) => s.kind === kinds[kind]);
        const picked = await this.languageThenFramework(ofKind, stacks, undefined, kinds[kind] === "fullstack" && combinable);
        if (typeof picked === "string")
            return picked;
        // «Combinar backend + frontend» (S16): the backend first, then the frontend.
        return `${await this.side("backend", stacks)}+${await this.side("frontend", stacks)}`;
    }
    /** Lenguaje → Framework among the stacks of one side of a combined project; a stack id typed is taken only from that side. */
    async side(side, stacks) {
        const ofSide = stacks.filter((s) => s.kind === side);
        // Without «Combinar» among the options, the answer is always a stack id.
        return (await this.languageThenFramework(ofSide, ofSide, side, false));
    }
    /**
     * The Lenguaje and Framework steps among `pool`; `typed` are the stack ids accepted when typed directly.
     * `side` names the half of a combined project in the questions. With `combine`, the language step also offers
     * «Combinar backend + frontend», and choosing it returns COMBINE instead of a stack id.
     */
    async languageThenFramework(pool, typed, side, combine) {
        const languages = [...new Set(pool.map((s) => s.language))].sort();
        const options = [
            ...languages.map((l) => ({ label: l, hint: pool.filter((s) => s.language === l).map((s) => s.id).join(", "), keys: [l] })),
            ...(combine ? [COMBINE] : []),
        ];
        const language = await this.step(side ? `Lenguaje del ${side}` : "Lenguaje", side ? `¿En qué lenguaje es el ${side}?` : "¿En qué lenguaje?", options, typed);
        if (typeof language === "string")
            return language;
        if (options[language] === COMBINE)
            return COMBINE;
        const candidates = pool.filter((s) => s.language === languages[language]);
        const framework = await this.step(side ? `Framework del ${side}` : "Framework", side ? `¿Con qué framework de ${side}?` : "¿Con qué framework?", candidates.map((s) => ({ label: s.name, hint: s.id, keys: [s.id] })), typed);
        return typeof framework === "string" ? framework : candidates[framework].id;
    }
    /**
     * One step of the stack question. Returns the chosen option's index, or the id of a stack typed
     * directly (numbered mode only). With a single option it asks nothing and says which one it took.
     */
    async step(title, question, options, stacks) {
        if (options.length === 1) {
            this.say(`${title}: ${options[0].label} (única opción)`);
            return 0;
        }
        if (this.arrows)
            return (await this.select(question, options, false))[0];
        const width = Math.max(...options.map((o) => o.label.length));
        this.say(question);
        options.forEach((o, i) => this.say(`  ${i + 1}) ${o.hint ? `${o.label.padEnd(width)}  ${o.hint}` : o.label}`));
        for (;;) {
            const answer = await this.line("Número o nombre: ");
            if (answer === undefined)
                throw new UsageError("No se eligió un stack. Usa --stack <id>");
            const index = optionIndex(options, answer);
            if (index >= 0)
                return index;
            const typed = stacks.find((s) => s.id.toLowerCase() === answer.toLowerCase());
            if (typed)
                return typed.id;
            this.say(answer ? `  «${answer}» no es una opción válida.` : "  Hace falta elegir una opción.");
        }
    }
    async agents(defaults) {
        const ids = AGENTS.map((a) => a.id);
        if (this.arrows) {
            const chosen = await this.select("¿Con qué herramientas vas a trabajar?", ids.map((id) => ({ label: id, hint: defaults.includes(id) ? "(por defecto)" : "" })), true, ids.flatMap((id, i) => (defaults.includes(id) ? [i] : [])));
            return chosen.map((i) => ids[i]);
        }
        const width = Math.max(...ids.map((id) => id.length));
        this.say("¿Con qué herramientas vas a trabajar? (puedes elegir varias, separadas por comas)");
        ids.forEach((id, i) => this.say(`  ${i + 1}) ${id.padEnd(width)}${defaults.includes(id) ? "  (por defecto)" : ""}`));
        for (;;) {
            const answer = await this.line(`Números o ids [${defaults.join(",")}]: `);
            if (!answer)
                return defaults;
            const tokens = answer.split(",").map((t) => t.trim()).filter(Boolean);
            const picked = tokens.map((t) => (/^\d+$/.test(t) ? ids[Number(t) - 1] : ids.find((id) => id === t)));
            const unknown = tokens.filter((_, i) => picked[i] === undefined);
            if (unknown.length === 0)
                return ids.filter((id) => picked.includes(id));
            this.say(`  No reconozco: ${unknown.join(", ")}. Usa los números o los ids de la lista.`);
        }
    }
    async context() {
        return (await this.line("¿De qué trata el proyecto? (una o dos frases; Enter para dejarlo vacío): ")) ?? "";
    }
    /**
     * Menu of options; returns the chosen option's `id`. In a terminal it moves with the arrow keys;
     * otherwise it is numbered: Enter takes the first option, an invalid answer asks again, and the
     * end of the input fails.
     */
    async choose(question, options) {
        if (this.arrows) {
            const [i] = await this.select(question, options, false);
            return options[i].id;
        }
        const width = Math.max(...options.map((o) => o.label.length));
        this.say(question);
        options.forEach((o, i) => this.say(`  ${i + 1}) ${o.label.padEnd(width)}  ${o.hint}`));
        for (;;) {
            const answer = await this.line("Número [1]: ");
            if (answer === undefined)
                throw new UsageError("No se eligió ninguna opción.");
            if (answer === "")
                return options[0].id;
            const chosen = /^\d+$/.test(answer) ? options[Number(answer) - 1] : undefined;
            if (chosen)
                return chosen.id;
            this.say(`  «${answer}» no es una opción válida.`);
        }
    }
    /** Yes/no question; Enter (or the end of the input) takes the default. */
    async confirm(question, byDefault) {
        for (;;) {
            const answer = await this.line(`${question} ${byDefault ? "[S/n]" : "[s/N]"}: `);
            if (!answer)
                return byDefault;
            if (/^(s|si|sí|y|yes)$/i.test(answer))
                return true;
            if (/^(n|no)$/i.test(answer))
                return false;
            this.say("  Responde s o n.");
        }
    }
}
