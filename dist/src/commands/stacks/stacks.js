import { AGENTS } from "../../kit/agents.js";
import { loadStacks } from "../../kit/stacks.js";
/** Lists the stacks read from `plantillas/stacks/*` and the supported agents. */
export function stacks(ctx) {
    const all = loadStacks();
    const width = Math.max(...all.map((s) => s.id.length));
    ctx.log("Stacks:");
    for (const s of all)
        ctx.log(`  ${s.id.padEnd(width)}  ${s.name} (puerto ${s.port})`);
    ctx.log(`Agentes: ${AGENTS.map((a) => a.id).join(", ")}`);
    return 0;
}
