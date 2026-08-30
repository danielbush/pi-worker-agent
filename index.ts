import { getDataRoot } from "./src/paths.ts";
import { Registry } from "./src/db.ts";

const registry = new Registry(getDataRoot());
const sessionId = process.env.PI_SESSION_ID;
if (!sessionId) {
  console.log("Set PI_SESSION_ID or use the Pi extension tools to inspect workers.");
} else {
  console.table(registry.listForSession(sessionId));
}
registry.close();
