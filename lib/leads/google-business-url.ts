type GoogleBusinessLead = {
  googlePlaceId?: string | null;
  placeId?: string | null;
  externalPlaceId?: string | null;
  source?: string | null;
  companyName?: string | null;
  name?: string | null;
  streetAddress?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
};

export function getGoogleBusinessUrl(lead: GoogleBusinessLead) {
  const placeId = lead.googlePlaceId || lead.placeId || (lead.source === "GOOGLE_PLACES" ? lead.externalPlaceId : null);
  if (placeId) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

  const query = [
    lead.companyName || lead.name,
    lead.streetAddress || lead.address,
    lead.postalCode,
    lead.city,
    lead.country,
  ].filter((value): value is string => Boolean(value?.trim())).join(" ");

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
