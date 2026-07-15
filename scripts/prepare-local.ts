import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

mkdirSync(join(process.cwd(), ".data"), { recursive: true });
mkdirSync(join(process.cwd(), "backups"), { recursive: true });
const database = join(process.cwd(), ".data", "leadfinder.db");
if (!existsSync(database)) closeSync(openSync(database, "a"));
console.info("Lokale mappen zijn gereed: .data en backups");
