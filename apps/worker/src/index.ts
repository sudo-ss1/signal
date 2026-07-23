import { runStage } from "./runner.js";
import { enrichHandler } from "./enrich.js";
import { researchHandler } from "./research.js";
import { scoreHandler } from "./score.js";
import { embedHandler } from "./embed.js";
import { routeHandler } from "./route.js";

const workers = [
  runStage("enrich", enrichHandler),
  runStage("research", researchHandler),
  runStage("score", scoreHandler),
  runStage("embed", embedHandler),
  runStage("route", routeHandler),
];

console.log(`[worker] started ${workers.length} stage workers`);
