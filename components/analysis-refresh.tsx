"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AnalysisRefresh({intervalMs=5000}:{intervalMs?:number}){
  const router=useRouter();
  useEffect(()=>{
    const timer=window.setInterval(()=>router.refresh(),intervalMs);
    return()=>window.clearInterval(timer);
  },[router,intervalMs]);
  return null;
}
