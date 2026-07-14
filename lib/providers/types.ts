import type { Lead,SearchInput } from "@/types/lead";
export interface LeadProvider{name:string;search(input:SearchInput):Promise<Lead[]>;}
