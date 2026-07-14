import { Radar } from "lucide-react";
export function Brand({ dark = false }: { dark?: boolean }) { return <div className="brand" style={dark ? { color: "#12211c", padding: 0 } : undefined}><span className="brand-mark"><Radar size={19}/></span><span>Leadfinder <small style={{opacity:.62,fontWeight:650}}>Sitora</small></span></div>; }
