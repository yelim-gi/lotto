const url=import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/,"");
const anon=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isConfigured=Boolean(url&&anon);
async function request(path,options={}){const headers={apikey:anon,Authorization:`Bearer ${anon}`,'Content-Type':'application/json',...(options.headers||{})};const r=await fetch(`${url}${path}`,{...options,headers});if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||j.error_description||j.error||`요청 실패 ${r.status}`)}return r.status===204?null:r.json()}
export async function select(table,query=''){return request(`/rest/v1/${table}?${query}`,{headers:{Prefer:'return=representation'}})}
