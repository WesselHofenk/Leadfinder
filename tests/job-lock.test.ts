import { beforeEach, describe, expect, it, vi } from "vitest";
let lock:{name:string;owner:string;expiresAt:Date}|null=null;
const tx={jobLock:{findUnique:vi.fn(async()=>lock),create:vi.fn(async({data})=>(lock=data)),update:vi.fn(async({data})=>(lock={name:"sync",...data}))}};
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:vi.fn(async(callback:(value:typeof tx)=>unknown)=>callback(tx)),jobLock:{deleteMany:vi.fn(async()=>({count:1}))}}}));
import { acquireJobLock } from "@/lib/jobs/lock";
import { quotaAllows } from "@/lib/jobs/quota";
describe("job lock",()=>{beforeEach(()=>{lock=null;vi.clearAllMocks()});it("voorkomt gelijktijdige synchronisaties",async()=>{expect(await acquireJobLock("sync")).not.toBeNull();expect(await acquireJobLock("sync")).toBeNull()})});
describe("daglimiet",()=>it("stopt nieuwe externe calls op de ingestelde limiet",()=>{expect(quotaAllows(249,250)).toBe(true);expect(quotaAllows(250,250)).toBe(false)}));
