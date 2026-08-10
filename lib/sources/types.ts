import type { Candidate } from "@/lib/leads/eligibility";
import type { OverpassEvent } from "@/lib/openstreetmap/overpass";

export type SourceSearch = {
  country: string;
  city: string;
  latitude: number;
  longitude: number;
  radius: number;
  category?: string;
  tileCursor?: number;
  signal?: AbortSignal;
  onEvent?: (event: OverpassEvent) => void | Promise<void>;
};

export type SourceSearchResult = {
  candidates: Candidate[];
  source: string;
  sourceUrl?: string;
  warnings: string[];
  tile?: string;
  queryType?: string;
};

export interface BusinessSourceAdapter {
  readonly id: string;
  readonly enabled: boolean;
  searchBusinesses(input: SourceSearch): Promise<SourceSearchResult>;
  findIdentityMatches?(candidate: Candidate, onEvent?: SourceSearch["onEvent"]): Promise<Candidate[]>;
}
