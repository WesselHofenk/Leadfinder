import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";

const dataFile=join(process.cwd(),".data","leadfinder.db");
const backupDir=join(process.cwd(),"backups");
async function main(){if(!existsSync(dataFile))throw new Error("Geen lokale database gevonden. Start eerst pnpm start:local.");mkdirSync(backupDir,{recursive:true});await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(FULL)");await prisma.$disconnect();const stamp=new Date().toISOString().replace(/[:.]/g,"-");const target=join(backupDir,`leadfinder-${stamp}.db`);copyFileSync(dataFile,target);console.info(`Back-up gemaakt: ${target}`);}
main().catch(async(error)=>{console.error(error instanceof Error?error.message:error);await prisma.$disconnect();process.exitCode=1;});
