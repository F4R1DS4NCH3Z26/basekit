import { createInterface } from "node:readline";
import * as clack from "@clack/prompts";
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
/**
 * Interactive questions. In a real terminal (raw mode) every question is a @clack/prompts prompt
 * (ADR 0002): menus with the arrow keys, checkboxes, yes/no and text. Otherwise it is numbered and
 * reads whole lines through one async iterator, so piped answers are kept.
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
     * Runs one clack question on this Prompter's streams. Ctrl+C or Esc (clack's cancel), Ctrl+D and the
     * end of the input throw CancelledError; clack restores the terminal before it returns.
     */
    async ask(prompt) {
        // A line reader would also consume the keys: the numbered mode recreates it when needed.
        this.close();
        const input = this.input;
        if (input.readableEnded)
            throw new CancelledError();
        const abort = new AbortController();
        const stop = () => abort.abort();
        const onKey = (_, key) => {
            if (key?.ctrl && key.name === "d")
                stop();
        };
        input.on("keypress", onKey);
        input.once("end", stop);
        input.once("close", stop);
        try {
            const answer = await prompt({ input, output: this.out, signal: abort.signal });
            if (clack.isCancel(answer))
                throw new CancelledError();
            return answer;
        }
        finally {
            input.removeListener("keypress", onKey);
            input.removeListener("end", stop);
            input.removeListener("close", stop);
        }
    }
    /** A clack menu among `items`, focused on `initial`; returns the chosen index. Hints show next to the focused option. */
    select(question, items, initial = 0) {
        return this.ask((streams) => clack.select({
            ...streams,
            message: question,
            options: items.map((it, i) => ({ value: i, label: it.label, ...(it.hint ? { hint: it.hint } : {}) })),
            initialValue: initial,
        }));
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
            return this.select(question, options);
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
    /** Which tools (S2): the defaults start checked; none is a valid answer (`ninguno`/`ninguna` without a terminal). */
    async agents(defaults) {
        return this.many("¿Con qué herramientas vas a trabajar?", "¿Con qué herramientas vas a trabajar? (puedes elegir varias, separadas por comas)", AGENTS.map((a) => a.id), defaults, { hint: "por defecto", names: "ids", rejectBlank: true });
    }
    /**
     * Which of the pinned external skills to install (S1): all start checked; none is a valid answer.
     * Without a terminal, an answer made only of commas or spaces is not none (S5): it asks again.
     */
    async externalSkills(skills) {
        const question = "¿Qué skills externas instalo? (usan npx y red)";
        return this.many(question, question, skills, skills, { hint: "", names: "nombres", rejectBlank: true });
    }
    /**
     * Multiple choice among `ids`, in their order, with `defaults` checked. In a terminal it is a menu
     * with checkboxes; otherwise numbered: numbers or names separated by commas, Enter (or the end of the
     * input) keeps the defaults, `ninguno`/`ninguna` chooses none and an unknown answer asks again
     * (with `rejectBlank`, also an answer made only of commas or spaces).
     */
    async many(question, lineQuestion, ids, defaults, o) {
        if (this.arrows) {
            const chosen = await this.ask((streams) => clack.multiselect({
                ...streams,
                message: question,
                options: ids.map((id) => ({ value: id, label: id, ...(o.hint && defaults.includes(id) ? { hint: o.hint } : {}) })),
                initialValues: ids.filter((id) => defaults.includes(id)),
                required: false,
            }));
            return ids.filter((id) => chosen.includes(id));
        }
        const width = Math.max(...ids.map((id) => id.length));
        this.say(lineQuestion);
        ids.forEach((id, i) => this.say(`  ${i + 1}) ${o.hint ? `${id.padEnd(width)}${defaults.includes(id) ? `  (${o.hint})` : ""}` : id}`));
        for (;;) {
            const answer = await this.line(`Números o ${o.names} [${defaults.join(",")}]: `);
            if (!answer)
                return defaults;
            if (/^ningun[oa]$/i.test(answer))
                return [];
            const tokens = answer.split(",").map((t) => t.trim()).filter(Boolean);
            if (tokens.length === 0 && o.rejectBlank) {
                this.say(`  No reconozco: ${answer}. Usa los números o los ${o.names} de la lista.`);
                continue;
            }
            const picked = tokens.map((t) => (/^\d+$/.test(t) ? ids[Number(t) - 1] : ids.find((id) => id === t)));
            const unknown = tokens.filter((_, i) => picked[i] === undefined);
            if (unknown.length === 0)
                return ids.filter((id) => picked.includes(id));
            this.say(`  No reconozco: ${unknown.join(", ")}. Usa los números o los ${o.names} de la lista.`);
        }
    }
    /** What the project is about, in a sentence or two; Enter alone (or the end of the input without a terminal) leaves it empty. */
    async context() {
        const question = "¿De qué trata el proyecto? (una o dos frases; Enter para dejarlo vacío)";
        if (this.arrows)
            return ((await this.ask((streams) => clack.text({ ...streams, message: question }))) ?? "").trim();
        return (await this.line(`${question}: `)) ?? "";
    }
    /**
     * Menu of options; returns the chosen option's `id`. In a terminal it is a clack menu that starts on
     * `byDefault`; otherwise it is numbered: Enter takes `byDefault` (the first option when omitted), an
     * invalid answer asks again, and the end of the input fails.
     */
    async choose(question, options, byDefault) {
        const initial = Math.max(0, options.findIndex((o) => o.id === byDefault));
        if (this.arrows)
            return options[await this.select(question, options, initial)].id;
        const width = Math.max(...options.map((o) => o.label.length));
        this.say(question);
        options.forEach((o, i) => this.say(`  ${i + 1}) ${o.label.padEnd(width)}  ${o.hint}`));
        for (;;) {
            const answer = await this.line(`Número [${initial + 1}]: `);
            if (answer === undefined)
                throw new UsageError("No se eligió ninguna opción.");
            if (answer === "")
                return options[initial].id;
            const chosen = /^\d+$/.test(answer) ? options[Number(answer) - 1] : undefined;
            if (chosen)
                return chosen.id;
            this.say(`  «${answer}» no es una opción válida.`);
        }
    }
    /** Yes/no question; Enter (or the end of the input without a terminal) takes the default. */
    async confirm(question, byDefault) {
        if (this.arrows)
            return this.ask((streams) => clack.confirm({ ...streams, message: question, active: "Sí", inactive: "No", initialValue: byDefault }));
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
