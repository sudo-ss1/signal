import { runStage } from "./runner.js";

const noop = async (_leadId: string) => {};

const workers = [
  runStage("enrich", noop),
  runStage("research", noop),
  runStage("score", noop),
  runStage("embed", noop),
  runStage("route", noop),
];

console.log(`[worker] started ${workers.length} stage workers`);
