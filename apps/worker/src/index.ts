import { runStage } from "./runner.js";
import { enrichHandler } from "./enrich.js";
import { researchHandler } from "./research.js";
import { scoreHandler } from "./score.js";

const noop = async (_leadId: string) => {};

const workers = [
  runStage("enrich", enrichHandler),
  runStage("research", researchHandler),
  runStage("score", scoreHandler),
  runStage("embed", noop),
  runStage("route", noop),
];

console.log(`[worker] started ${workers.length} stage workers`);
