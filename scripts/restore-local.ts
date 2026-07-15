import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const sourceArg=process.argv.find((value,index)=>index>1&&!value.startsWith("--"));
if(!sourceArg||!process.argv.includes("--apply")){console.error("Gebruik: pnpm db:restore -- backups/leadfinder-DATUM.db --apply");process.exit(1);}
const source=resolve(sourceArg);const target=join(process.cwd(),".data","leadfinder.db");
if(!existsSync(source)||!source.endsWith(".db"))throw new Error("Kies een bestaande .db-back-up.");
const fd=openSync(source,"r");const header=Buffer.alloc(16);readSync(fd,header,0,16,0);closeSync(fd);
if(header.toString("utf8")!=="SQLite format 3\u0000")throw new Error("Het bestand is geen geldige SQLite-database.");
mkdirSync(join(process.cwd(),".data"),{recursive:true});mkdirSync(join(process.cwd(),"backups"),{recursive:true});
if(existsSync(target)){const safety=join(process.cwd(),"backups",`pre-restore-${Date.now()}.db`);copyFileSync(target,safety);console.info(`Veiligheidskopie: ${safety}`);}
copyFileSync(source,target);console.info(`Hersteld uit ${basename(source)}. Start de lokale server opnieuw.`);
