const hits=new Map<string,{count:number;reset:number}>();
export function rateLimit(key:string,limit=10,windowMs=60000){const now=Date.now(),c=hits.get(key);if(!c||c.reset<now){hits.set(key,{count:1,reset:now+windowMs});return true;}if(c.count>=limit)return false;c.count+=1;return true;}
