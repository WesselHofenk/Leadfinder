import Link from "next/link";
import { Download, ExternalLink, Filter, MapPin, Search } from "lucide-react";
import { parseLeadFilters, leadStatuses } from "@/lib/leads/filters";
import { listLeads } from "@/lib/leads/service";
import { dateFormatter, numberFormatter, statusLabels } from "@/lib/format";
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
  const { items, total, pages, page } = await listLeads(filters);
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
  return (
    <div className="content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Kansenbestand</span>
          <h1>{filters.filtered ? "Gefilterde leads" : "Actieve leads"}</h1>
          <p className="muted">
            Nederlandse en Belgische bedrijven met een concrete websitekans.
          </p>
        </div>
        <div className="actions">
          <GenerationButton />
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
            options={[
              ["NO_WEBSITE", "Geen website"],
              ["OUTDATED_WEBSITE", "Verouderde website"],
              ["IMPROVABLE_WEBSITE", "Website verbeterbaar"],
            ]}
          />
          <Select
            label="Status"
            name="status"
            value={filters.status}
            options={leadStatuses.map((v) => [v, statusLabels[v]])}
          />
          <TextFilter label="Plaats" name="city" value={filters.city} />
          <TextFilter
            label="Branche"
            name="category"
            value={filters.category}
          />
          <TextFilter label="Regio" name="region" value={filters.region} />
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
          <Select label="Website-status" name="websiteStatus" value={filters.websiteStatus} options={[["NO_OWN_WEBSITE", "Geen eigen website"], ["OUTDATED", "Sterk verouderd"], ["IMPROVABLE", "Verbeterbaar"], ["OWN_WEBSITE", "Bruikbaar"]]}/>
          <Select label="Gebeld" name="called" value={filters.called} options={[["yes", "Ja"], ["no", "Nee"]]}/>
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
      </form>
      <section className="card table-card">
        {items.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Branche</th>
                    <th>Bedrijf</th>
                    <th>Contact</th>
                    <th>Locatie</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Confidence</th>
                    <th>Belangrijkste reden</th>
                    <th>Status</th>
                    <th>Gevonden</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.category.replaceAll("_", " ")}</td>
                      <td>
                        <Link className="company" href={`/leads/${lead.id}`}>
                          {lead.companyName}
                        </Link>
                        <div className="small muted">
                          {lead.contactPersonName || "Contactpersoon onbekend"}
                        </div>
                      </td>
                      <td>
                        <strong>{lead.normalizedPhoneNumber}</strong>
                        <div className="small muted">
                          {lead.email || "Geen e-mail"}
                        </div>
                      </td>
                      <td>
                        {lead.city}
                        <div className="small muted">{lead.country}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${lead.leadType === "NO_WEBSITE" ? "badge-green" : "badge-amber"}`}
                        >
                          {statusLabels[lead.leadType]}
                        </span>
                      </td>
                      <td>
                        <strong
                          style={{
                            fontSize: 17,
                            color:
                              lead.opportunityScore >= 70
                                ? "var(--brand)"
                                : "var(--warning)",
                          }}
                        >
                          {lead.opportunityScore}
                        </strong>
                        /100
                      </td>
                      <td><strong>{lead.confidenceScore}</strong>/100<div className="small muted">{lead.confidenceLevel.toLowerCase()}</div></td>
                      <td className="small">
                        {lead.leadType === "NO_WEBSITE"
                          ? "Geen website gevonden"
                          : lead.filterReason || "Websiteverbetering mogelijk"}
                      </td>
                      <td>
                        <QuickStatus leadId={lead.id} status={lead.status} />
                      </td>
                      <td>{dateFormatter.format(lead.firstDiscoveredAt)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          <a
                            className="button button-secondary"
                            href={lead.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open Google Maps"
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
              Pas de filters aan of wacht op de volgende automatische scan.
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
              color: "#718078",
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
