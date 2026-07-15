import type { Candidate } from "@/lib/leads/eligibility";

export type SourceSearch = {
  country: string;
  city: string;
  latitude: number;
  longitude: number;
  radius: number;
  category?: string;
};

export type SourceSearchResult = {
  candidates: Candidate[];
  source: string;
  sourceUrl?: string;
  warnings: string[];
};

export interface BusinessSourceAdapter {
  readonly id: string;
  readonly enabled: boolean;
  searchBusinesses(input: SourceSearch): Promise<SourceSearchResult>;
}
