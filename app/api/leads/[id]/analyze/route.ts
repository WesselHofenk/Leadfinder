import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { queueWebsiteAnalysis } from "@/lib/jobs/website";
import { hasValidOrigin, rateLimit } from "@/lib/security/request";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){const user=await currentUser();if(!user)return NextResponse.json({error:"Niet ingelogd"},{status:401});if(!hasValidOrigin(request))return NextResponse.json({error:"Ongeldige aanvraag"},{status:403});if(!rateLimit(`analysis:${user.id}`,5,60*60_000))return NextResponse.json({error:"U kunt maximaal vijf analyses per uur starten"},{status:429});try{const{id}=await params;return NextResponse.json({job:await queueWebsiteAnalysis(id)},{status:202})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Inplannen mislukt"},{status:400})}}
