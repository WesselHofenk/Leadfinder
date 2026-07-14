import { LeadDetail } from "@/components/leads/lead-detail";
export default async function Page({params}:{params:Promise<{id:string}>}){return <LeadDetail id={(await params).id}/>}
