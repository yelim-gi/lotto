const url=import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/,"");
const anon=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isConfigured=Boolean(url&&anon);
const key='lotto-anon-session';
async function request(path,options={}){const session=JSON.parse(localStorage.getItem(key)||'null');const headers={apikey:anon,Authorization:`Bearer ${session?.access_token||anon}`,'Content-Type':'application/json',...(options.headers||{})};const r=await fetch(`${url}${path}`,{...options,headers});if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||j.error_description||j.error||`요청 실패 ${r.status}`)}return r.status===204?null:r.json()}
export async function ensureAnonymousUser(){if(!isConfigured)return null;let session=JSON.parse(localStorage.getItem(key)||'null');if(session?.access_token&&session?.user)return session.user;session=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({})});localStorage.setItem(key,JSON.stringify(session));return session.user;}
export async function select(table,query=''){return request(`/rest/v1/${table}?${query}`,{headers:{Prefer:'return=representation'}})}
export async function insert(table,row){const data=await request(`/rest/v1/${table}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});return data?.[0]}
export async function remove(table,id){return request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}})}
