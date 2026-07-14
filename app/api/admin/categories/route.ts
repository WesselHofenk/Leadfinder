import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { hasValidOrigin } from "@/lib/security/request";
const createSchema=z.object({kind:z.enum(["category","excluded"]),name:z.string().trim().min(2).max(100),reason:z.string().trim().max(300).optional()});
const patchSchema=z.object({kind:z.enum(["category","excluded"]),id:z.string(),isActive:z.boolean()});
const slug=(value:string)=>value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
async function authorized(){const user=await currentUser();return user?.role==="ADMIN"}
export async function POST(request:NextRequest){if(!await authorized())return NextResponse.json({error:"Niet toegestaan"},{status:403});if(!hasValidOrigin(request))return NextResponse.json({error:"Ongeldige aanvraag"},{status:403});const input=createSchema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:"Ongeldige categorie"},{status:400});if(input.data.kind==="category")await prisma.category.create({data:{name:input.data.name,slug:slug(input.data.name)}});else await prisma.excludedCategory.create({data:{name:input.data.name,slug:slug(input.data.name),reason:input.data.reason||"Handmatig uitgesloten"}});return NextResponse.json({ok:true},{status:201})}
export async function PATCH(request:NextRequest){if(!await authorized())return NextResponse.json({error:"Niet toegestaan"},{status:403});if(!hasValidOrigin(request))return NextResponse.json({error:"Ongeldige aanvraag"},{status:403});const input=patchSchema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:"Ongeldige categorie"},{status:400});if(input.data.kind==="category")await prisma.category.update({where:{id:input.data.id},data:{isActive:input.data.isActive}});else await prisma.excludedCategory.update({where:{id:input.data.id},data:{isActive:input.data.isActive}});return NextResponse.json({ok:true})}
