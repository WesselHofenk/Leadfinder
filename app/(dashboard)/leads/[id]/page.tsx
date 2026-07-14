import { LeadDetail } from "@/components/leads/lead-detail";
import { demoLeads } from "@/lib/demo/leads";

export function generateStaticParams(){return demoLeads.map(({id})=>({id}))}
export default async function Page({params}:{params:Promise<{id:string}>}){return <LeadDetail id={(await params).id}/>}
