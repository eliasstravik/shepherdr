// herdr-mcp's entry (bin/herdr-mcp runs it; `bun run build` bundles it to web/dist/herdr-mcp.mjs for other machines)
import { main } from "./gateway.ts";

void main();
