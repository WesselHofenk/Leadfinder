import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function Home() { redirect((await currentUser()) ? "/dashboard" : await prisma.user.count() ? "/login" : "/setup"); }
