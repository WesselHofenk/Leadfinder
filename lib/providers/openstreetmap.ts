import type { LeadProvider } from "./types";import type { Lead,SearchInput } from "@/types/lead";
export class OpenStreetMapProvider implements LeadProvider{name="openstreetmap";async search(input:SearchInput):Promise<Lead[]>{void input;return[];}}
