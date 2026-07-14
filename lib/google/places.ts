import "server-only";
import type { Candidate } from "@/lib/leads/eligibility";
import { backoffDelayMs, isRetryableStatus } from "@/lib/jobs/backoff";

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };
type GooglePlace = {
  id?: string; displayName?: { text?: string }; nationalPhoneNumber?: string; internationalPhoneNumber?: string;
  websiteUri?: string; businessStatus?: string; formattedAddress?: string; addressComponents?: AddressComponent[];
  location?: { latitude?: number; longitude?: number }; googleMapsUri?: string; primaryType?: string; types?: string[];
};

const fieldMask = ["places.id","places.displayName","places.nationalPhoneNumber","places.internationalPhoneNumber","places.websiteUri","places.businessStatus","places.formattedAddress","places.addressComponents","places.location","places.googleMapsUri","places.primaryType","places.types","nextPageToken"].join(",");

function component(items: AddressComponent[] = [], type: string, short = false) {
  const value = items.find((item) => item.types?.includes(type));
  return short ? value?.shortText : value?.longText;
}

async function requestWithBackoff(url: string, init: RequestInit, attempts = 4) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if (!isRetryableStatus(response.status)) throw new Error(`Google Places weigerde de aanvraag (${response.status})`);
      lastError = new Error(`Tijdelijke Google Places-fout (${response.status})`);
    } catch (error) { lastError = error instanceof Error ? error : new Error("Onbekende netwerkfout"); }
    await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt, Math.random() * 250)));
  }
  throw lastError ?? new Error("Google Places is niet bereikbaar");
}

export async function searchPlaces(params: { apiKey: string; query: string; country: string; latitude: number; longitude: number; radius: number; pageToken?: string }) {
  const body: Record<string, unknown> = {
    textQuery: `${params.query} in ${params.country === "BE" ? "België" : "Nederland"}`,
    languageCode: params.country === "BE" ? "nl" : "nl",
    regionCode: params.country,
    maxResultCount: 20,
    includePureServiceAreaBusinesses: false,
    locationBias: { circle: { center: { latitude: params.latitude, longitude: params.longitude }, radius: Math.min(params.radius, 50_000) } },
  };
  if (params.pageToken) body.pageToken = params.pageToken;
  const response = await requestWithBackoff("https://places.googleapis.com/v1/places:searchText", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": params.apiKey, "X-Goog-FieldMask": fieldMask }, body: JSON.stringify(body), cache: "no-store",
  });
  const data = await response.json() as { places?: GooglePlace[]; nextPageToken?: string };
  const candidates: Candidate[] = (data.places ?? []).flatMap((place) => {
    const latitude = place.location?.latitude; const longitude = place.location?.longitude;
    if (!place.id || !place.displayName?.text || latitude == null || longitude == null) return [];
    const country = component(place.addressComponents, "country", true)?.toUpperCase() || params.country;
    return [{
      externalPlaceId: place.id, companyName: place.displayName.text, phoneNumber: place.nationalPhoneNumber,
      internationalPhoneNumber: place.internationalPhoneNumber, website: place.websiteUri, businessStatus: place.businessStatus,
      country, category: place.primaryType || place.types?.[0] || params.query, subCategory: place.types?.[1],
      province: component(place.addressComponents, "administrative_area_level_1"), municipality: component(place.addressComponents, "administrative_area_level_2"),
      city: component(place.addressComponents, "locality") || component(place.addressComponents, "postal_town") || "Onbekend",
      postalCode: component(place.addressComponents, "postal_code"), streetAddress: place.formattedAddress || "",
      latitude, longitude, googleMapsUrl: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}`,
    }];
  });
  return { candidates, nextPageToken: data.nextPageToken };
}

export async function getPlaceDetails(apiKey: string, placeId: string, fallbackCountry: string): Promise<Candidate | null> {
  const detailsMask = "id,displayName,nationalPhoneNumber,internationalPhoneNumber,websiteUri,businessStatus,formattedAddress,addressComponents,location,googleMapsUri,primaryType,types";
  const response = await requestWithBackoff(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, { headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": detailsMask }, cache: "no-store" });
  const place = await response.json() as GooglePlace; const latitude = place.location?.latitude; const longitude = place.location?.longitude;
  if (!place.id || !place.displayName?.text || latitude == null || longitude == null) return null;
  return { externalPlaceId: place.id, companyName: place.displayName.text, phoneNumber: place.nationalPhoneNumber, internationalPhoneNumber: place.internationalPhoneNumber, website: place.websiteUri, businessStatus: place.businessStatus, country: component(place.addressComponents,"country",true)?.toUpperCase()||fallbackCountry, category: place.primaryType||place.types?.[0]||"bedrijf", subCategory: place.types?.[1], province: component(place.addressComponents,"administrative_area_level_1"), municipality: component(place.addressComponents,"administrative_area_level_2"), city: component(place.addressComponents,"locality")||component(place.addressComponents,"postal_town")||"Onbekend", postalCode: component(place.addressComponents,"postal_code"), streetAddress: place.formattedAddress||"", latitude, longitude, googleMapsUrl: place.googleMapsUri||`https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}` };
}
