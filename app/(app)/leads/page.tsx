import Link from "next/link";
import { Download, ExternalLink, Filter, MapPin, Search } from "lucide-react";
import { parseLeadFilters } from "@/lib/leads/filters";
import { listLeads } from "@/lib/leads/service";
import { toPipelineOptions } from "@/lib/leads/pipeline";
import { prisma } from "@/lib/prisma";
import { getGoogleBusinessUrl } from "@/lib/leads/google-business-url";
import { numberFormatter, statusLabels } from "@/lib/format";
import { QuickStatus } from "@/components/lead-actions";
import { GenerationButton } from "@/components/generation-button";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const filters = parseLeadFilters(raw);
  const [{ items, total, pages, page }, stages] = await Promise.all([
    listLeads(filters),
    prisma.pipelineStage.findMany({ where: { isActive: true }, orderBy: { position: "asc" } }),
  ]);
  const stageOptions = toPipelineOptions(stages);
  const qs = new URLSearchParams(
    Object.entries(raw).flatMap(([k, v]) =>
      v ? [[k, Array.isArray(v) ? v[0] : v]] : [],
    ),
  );
  qs.delete("page");
  const pageHref = (value: number) => {
    const p = new URLSearchParams(qs);
    p.set("page", String(value));
    return `/leads?${p}`;
  };
  const exportQs = new URLSearchParams(qs);
  const activeFilters = [...qs.entries()].filter(([key]) => !["sort", "pageSize"].includes(key));
  const removeFilterHref = (key: string) => {
    const next = new URLSearchParams(qs);
    next.delete(key);
    return `/leads${next.size ? `?${next}` : ""}`;
  };
  return (
    <div className="content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Kansenbestand</span>
          <h1>{filters.filtered ? "Gefilterde leads" : "Alle actieve leads"}</h1>
          <p className="muted">
            Bestaande en nieuw gevalideerde bedrijven met behoud van hun websitecontrole, historie en pipelinefase.
          </p>
        </div>
        <div className="actions">
          <GenerationButton />
          <Link className="button button-secondary" href="/leads?googleReview=pending">Google-controle nodig</Link>
          <a
            className="button button-secondary"
            href={`/api/export?${exportQs}`}
          >
            <Download size={15} />
            CSV
          </a>
          <a
            className="button button-secondary"
            href={`/api/export?${exportQs}&format=xlsx`}
          >
            <Download size={15} />
            Excel
          </a>
          <a className="button button-secondary" href={`/api/export?${exportQs}&format=json`}><Download size={15}/>JSON</a>
        </div>
      </header>
      <form className="card filters" method="get">
        <div className="filter-grid">
          <TextFilter label="Zoeken" name="q" value={filters.q} icon />
          <Select
            label="Land"
            name="country"
            value={filters.country}
            options={[
              ["NL", "Nederland"],
              ["BE", "België"],
            ]}
          />
          <Select
            label="Leadtype"
            name="leadType"
            value={filters.leadType}
            options={[["NO_WEBSITE", "Geen website (Google bevestigd)"],["OUTDATED_WEBSITE", "Verouderde website"],["IMPROVABLE_WEBSITE", "Website kapot / controle nodig"]]}
          />
          <Select
            label="Status"
            name="status"
            value={filters.status}
            options={stageOptions.map((stage) => [stage.slug, stage.name])}
          />
          <TextFilter label="Plaats" name="city" value={filters.city} />
          <TextFilter
            label="Branche"
            name="category"
            value={filters.category}
          />
          <TextFilter label="Regio" name="region" value={filters.region} />
          <TextFilter label="Gemeente" name="municipality" value={filters.municipality} />
          <TextFilter
            label="Postcode"
            name="postalCode"
            value={filters.postalCode}
          />
          <div className="field">
            <label htmlFor="minScore">Min. Opportunity Score</label>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              id="minScore"
              name="minScore"
              defaultValue={filters.minScore}
            />
          </div>
          <div className="field">
            <label htmlFor="maxScore">Max. Opportunity Score</label>
            <input className="input" type="number" min="0" max="100" id="maxScore" name="maxScore" defaultValue={filters.maxScore}/>
          </div>
          <div className="field">
            <label htmlFor="minConfidence">Min. confidence</label>
            <input className="input" type="number" min="0" max="100" id="minConfidence" name="minConfidence" defaultValue={filters.minConfidence}/>
          </div>
          <Select label="Website-status" name="websiteStatus" value={filters.websiteStatus} options={[["NO_WEBSITE_CONFIRMED","Geen website bevestigd"],["NO_WEBSITE_LIKELY","Waarschijnlijk geen website"],["SOCIAL_ONLY","Alleen extern profiel"],["WEBSITE_FOUND","Website gevonden"],["WEBSITE_OUTDATED","Website verouderd"],["WEBSITE_BROKEN","Website kapot"],["MANUAL_REVIEW_REQUIRED","Handmatige controle"],["UNKNOWN","Onbekend"]]}/>
          <Select label="Databron" name="source" value={filters.source} options={[["OPENSTREETMAP","OpenStreetMap"],["OPEN_DATA","Open data"],["PUBLIC_WEBSITE","Openbare website"],["MANUAL","Handmatig"]]}/>
          <Select label="Google-controle" name="googleReview" value={filters.googleReview} options={[["pending","Nog controleren"],["confirmed","Handmatig bevestigd"]]}/>
          <Select label="Bedrijfsstatus" name="businessStatus" value={filters.businessStatus} options={[["OPERATIONAL","Operationeel"],["CLOSED_TEMPORARILY","Tijdelijk gesloten"],["CLOSED_PERMANENTLY","Permanent gesloten"],["FUTURE_OPENING","Toekomstige opening"],["UNKNOWN","Onbekend"]]}/>
          <Select label="Telefoon" name="hasPhone" value={filters.hasPhone} options={[["yes","Aanwezig"],["no","Ontbreekt"]]}/>
          <Select label="E-mail" name="hasEmail" value={filters.hasEmail} options={[["yes","Aanwezig"],["no","Ontbreekt"]]}/>
          <Select label="Sorteren" name="sort" value={filters.sort} options={[["newest","Nieuwste lead"],["confidence_desc","Hoogste website-confidence"],["opportunity_desc","Hoogste opportunity"],["oldest","Oudste lead"],["checked_desc","Laatst gecontroleerd"],["city","Plaats"],["category","Branche"],["status","Pipelinestatus"],["contacts_desc","Meeste contactmogelijkheden"]]}/>
          <Select label="Opgevolgd" name="called" value={filters.called} options={[["yes", "Ja"], ["no", "Nee"]]}/>
          <div className="field"><label htmlFor="foundAfter">Gevonden vanaf</label><input className="input" type="date" id="foundAfter" name="foundAfter" defaultValue={raw.foundAfter as string | undefined}/></div>
          <div className="field"><label htmlFor="foundBefore">Gevonden t/m</label><input className="input" type="date" id="foundBefore" name="foundBefore" defaultValue={raw.foundBefore as string | undefined}/></div>
          <Select
            label="Websiteprobleem"
            name="issue"
            value={filters.issue}
            options={[
              ["UNREACHABLE", "Niet bereikbaar"],
              ["NOT_MOBILE_FRIENDLY", "Niet mobielvriendelijk"],
              ["VERY_SLOW_MOBILE", "Zeer traag mobiel"],
              ["BROKEN_LINKS", "Kapotte links"],
              ["NO_CTA", "Geen call-to-action"],
            ]}
          />
          <Select
            label="Pipeline"
            name="filtered"
            value={filters.filtered}
            options={[["yes", "Gefilterde leads"]]}
          />
          <div className="field">
            <label htmlFor="pageSize">Per pagina</label>
            <select
              className="select"
              id="pageSize"
              name="pageSize"
              defaultValue={filters.pageSize}
            >
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="filter-actions">
          <Link href="/leads" className="button button-secondary">
            Reset
          </Link>
          <button className="button button-primary">
            <Filter size={14} />
            Filters toepassen
          </button>
        </div>
        {activeFilters.length ? (
          <div className="active-filters" aria-label="Actieve filters">
            <span className="small muted">Actief:</span>
            {activeFilters.map(([key, value]) => (
              <Link className="filter-chip" href={removeFilterHref(key)} key={key} aria-label={`Verwijder filter ${filterLabel(key)}`}>
                {filterLabel(key)}: {value} <span aria-hidden="true">×</span>
              </Link>
            ))}
            <Link href="/leads" className="filter-clear">Alles wissen</Link>
          </div>
        ) : null}
      </form>
      <section className="card table-card">
        {items.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Bedrijf</th>
                    <th>Telefoon</th>
                    <th>Adres</th>
                    <th>Plaats</th>
                    <th>Branche</th>
                    <th>Land</th>
                    <th>Bedrijfsstatus</th>
                    <th>Website</th>
                    <th>Taal</th>
                    <th>Bron</th>
                    <th>Pipeline</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <Link className="company" href={`/leads/${lead.id}`}>
                          {lead.companyName}
                        </Link>
                        <div className="small muted">
                          {lead.contactPersonName || "Contactpersoon onbekend"}
                        </div>
                      </td>
                       <td>{lead.normalizedPhoneNumber || lead.phoneNumber ? <a className="text-link" href={`tel:${lead.normalizedPhoneNumber || lead.phoneNumber}`}>{lead.normalizedPhoneNumber || lead.phoneNumber}</a> : "Niet beschikbaar"}</td>
                      <td><a className="text-link" href={getGoogleBusinessUrl(lead)} target="_blank" rel="noopener noreferrer">{lead.formattedAddress || lead.streetAddress}</a></td>
                      <td>{lead.city}</td>
                      <td>{lead.category.replaceAll("_", " ")}</td>
                      <td>{lead.country}</td>
                      <td>{lead.businessStatus === "OPERATIONAL" ? "Actief" : statusLabels[lead.businessStatus]}</td>
                      <td>Geen eigen website</td>
                      <td>{lead.language === "nl" ? "Nederlands" : lead.language || "Onbekend"}</td>
                      <td>{statusLabels[lead.source]}</td>
                      <td>
                        <QuickStatus leadId={lead.id} stageSlug={lead.pipelineStage.slug} stages={stageOptions} />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          <a
                            className="button button-secondary"
                            href={getGoogleBusinessUrl(lead)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open Google-bedrijfspagina van ${lead.companyName}`}
                          >
                            <MapPin size={14} />
                          </a>
                          <Link
                            className="button button-secondary"
                            href={`/leads/${lead.id}`}
                            aria-label={`Open ${lead.companyName}`}
                          >
                            <ExternalLink size={14} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span className="small muted">
                {numberFormatter.format(total)} resultaten · pagina {page} van{" "}
                {pages}
              </span>
              <div className="pagination-links">
                <Link
                  aria-disabled={page <= 1}
                  className="button button-secondary"
                  href={pageHref(Math.max(1, page - 1))}
                >
                  Vorige
                </Link>
                <Link
                  aria-disabled={page >= pages}
                  className="button button-secondary"
                  href={pageHref(Math.min(pages, page + 1))}
                >
                  Volgende
                </Link>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            <Search size={30} />
            <strong>Geen leads gevonden</strong>
            <span>
              Pas de filters aan of start een lokale zoekrun.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
function TextFilter({
  label,
  name,
  value,
  icon,
}: {
  label: string;
  name: string;
  value?: string;
  icon?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <div style={{ position: "relative" }}>
        {icon && (
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 11,
              top: 12,
              color: "var(--muted)",
            }}
          />
        )}
        <input
          className="input"
          style={icon ? { paddingLeft: 34 } : undefined}
          id={name}
          name={name}
          defaultValue={value}
        />
      </div>
    </div>
  );
}
function Select({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: (readonly [string, string])[];
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select
        className="select"
        id={name}
        name={name}
        defaultValue={value || ""}
      >
        <option value="">Alle</option>
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

const filterLabels: Record<string, string> = {
  q: "Zoeken", country: "Land", region: "Regio", municipality: "Gemeente", city: "Plaats", postalCode: "Postcode",
  category: "Branche", status: "Status", leadType: "Leadtype", websiteStatus: "Website-status", source: "Bron",
  businessStatus: "Bedrijfsstatus", filtered: "Pipeline", googleReview: "Google-controle", hasPhone: "Telefoon", hasEmail: "E-mail", minScore: "Min. score",
  maxScore: "Max. score", minConfidence: "Min. confidence", called: "Opgevolgd", issue: "Websiteprobleem", foundAfter: "Vanaf", foundBefore: "Tot",
};

function filterLabel(key: string) {
  return filterLabels[key] ?? key;
}
