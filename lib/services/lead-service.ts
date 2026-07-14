import type { Lead,SearchInput } from "@/types/lead";
import { MockLeadProvider } from "@/lib/providers/mock";

export async function searchLeads(input:SearchInput):Promise<{leads:Lead[];provider:string}>{
  if(process.env.NEXT_PUBLIC_STATIC_EXPORT==="true"){
    const provider=new MockLeadProvider();
    return {leads:await provider.search(input),provider:provider.name};
  }
  const response=await fetch("/api/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"De zoekopdracht kon niet worden uitgevoerd.");
  return data;
}
