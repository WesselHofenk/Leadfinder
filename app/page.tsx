import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export default async function Home() { redirect((await currentUser()) ? "/dashboard" : "/login"); }
