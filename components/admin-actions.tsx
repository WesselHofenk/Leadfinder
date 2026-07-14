"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
export function RetryJobButton({id}:{id:string}){const router=useRouter();const[pending,setPending]=useState(false);async function retry(){setPending(true);await fetch(`/api/admin/jobs/${id}/retry`,{method:"POST"});setPending(false);router.refresh();}return <button className="button button-secondary" onClick={retry} disabled={pending}>{pending?<LoaderCircle className="animate-spin" size={14}/>:<RotateCcw size={14}/>}Opnieuw</button>}
