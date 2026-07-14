import { compare, hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, destroySession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { hasValidOrigin, rateLimit } from "@/lib/security/request";
const schema=z.object({currentPassword:z.string().min(8).max(200),newPassword:z.string().min(12).max(200)});
export async function POST(request:NextRequest){const user=await currentUser();if(!user)return NextResponse.json({error:"Niet ingelogd"},{status:401});if(!hasValidOrigin(request))return NextResponse.json({error:"Ongeldige aanvraag"},{status:403});if(!rateLimit(`password:${user.id}`,5,60*60_000))return NextResponse.json({error:"Te veel pogingen"},{status:429});const input=schema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:"Nieuw wachtwoord moet minimaal 12 tekens bevatten"},{status:400});const record=await prisma.user.findUniqueOrThrow({where:{id:user.id}});if(!await compare(input.data.currentPassword,record.passwordHash))return NextResponse.json({error:"Huidig wachtwoord is onjuist"},{status:401});await prisma.user.update({where:{id:user.id},data:{passwordHash:await hash(input.data.newPassword,12)}});await destroySession();return NextResponse.json({ok:true})}
