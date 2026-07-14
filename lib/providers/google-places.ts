import type { LeadProvider } from "./types";import type { Lead,SearchInput } from "@/types/lead";
export class GooglePlacesProvider implements LeadProvider{name="google_places";constructor(private apiKey:string){}async search(input:SearchInput):Promise<Lead[]>{void input;if(!this.apiKey)throw new Error("Google Places API-sleutel ontbreekt");return[];}}
