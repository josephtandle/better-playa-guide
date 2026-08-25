#!/usr/bin/env bash
# Scour every camp for website / instagram / socials / schedule page, and REMEMBER the result
# so repeat runs only work on what is still unknown.
#
#   bin/enrich-camps.sh              # enrich camps with no contact info yet
#   bin/enrich-camps.sh --all        # re-check everything, including already-known
#   bin/enrich-camps.sh --ig-only    # only verify/resolve instagram handles
#
# Most camps have nothing. That is expected and is itself recorded, so we stop re-checking them.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
MODE="${1:-}"
node - "$MODE" <<'JS'
const fs=require('fs'), path=require('path'), {execFileSync}=require('child_process');
const MODE=process.argv[2]||'';
const DIR='data/camp-directory.json';
const d=JSON.parse(fs.readFileSync(DIR,'utf8'));
const C=d.camps;
const SUBPATHS=['events','schedule','lineup','program','calendar','workshops','talks','activities','burning-man'];
const UA_BOT='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_STD='Mozilla/5.0 (compatible; BurnerEventsBot/1.0)';
const now=new Date().toISOString().slice(0,10);

function fetchText(url,ua,ms=12){
  try{ return execFileSync('curl',['-sSL','--max-time',String(ms),'--max-filesize','3000000','-A',ua,url],
    {encoding:'utf8',maxBuffer:1<<26}); }catch(e){ return ''; }
}
// Instagram blocks normal fetches; Googlebot still gets og: meta. No og data => handle is not real.
function igCheck(handle){
  const h=String(handle).replace(/^@/,'').replace(/\/$/,'');
  const s=fetchText(`https://www.instagram.com/${h}/`,UA_BOT);
  const t=/<meta property="og:title" content="([^"]*)"/.exec(s);
  const g=/<meta property="og:description" content="([^"]*)"/.exec(s);
  if(!t&&!g) return null;
  const name=t?t[1].split('(')[0].trim():null;
  const m=/([\d.,KM]+) Followers, [\d.,KM]+ Following, ([\d.,KM]+) Posts/.exec(g?g[1]:'');
  return {handle:h, display_name:name, followers:m?m[1]:null, posts:m?m[2]:null};
}
const SOCIAL={
  instagram:/(?:instagram\.com)\/([A-Za-z0-9_][A-Za-z0-9_.]{1,28}[A-Za-z0-9_])/i,
  facebook:/facebook\.com\/([A-Za-z0-9_.\-]{3,50})/i,
  soundcloud:/soundcloud\.com\/([A-Za-z0-9_\-]{3,40})/i,
  youtube:/youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9_\-]{3,40})/i,
  linktree:/(linktr\.ee\/[A-Za-z0-9_.\-]+)/i,
};
const BAD_IG=new Set(['p','reel','explore','accounts','squarespace','about','legal','developer','tv','stories','share']);

const entries=Object.entries(C);
let scanned=0, gained=0, marked=0;
for(const [k,r] of entries){
  const hasContact = r.website||r.instagram||r.facebook||r.email;
  if(MODE!=='--all' && MODE!=='--ig-only' && hasContact && r.enriched_on) continue;
  if(MODE==='--ig-only' && !r.instagram) continue;

  // 1. verify an existing handle
  if(r.instagram && (MODE==='--all'||MODE==='--ig-only'||!r.instagram_checked_on)){
    const v=igCheck(r.instagram); scanned++;
    if(v){ r.instagram_display_name=v.display_name; r.instagram_followers=v.followers;
           r.instagram_posts=v.posts; r.instagram_checked_on=now;
           if(v.posts==='0'||v.followers==='0') r.instagram_dormant='0 posts or 0 followers — will not post a schedule';
    } else { r.instagram_unresolved='googlebot og-check returned nothing — handle may be wrong or deleted';
             r.instagram_checked_on=now; }
  }
  // 2. mine the website for socials + find a schedule page
  if(r.website && (MODE==='--all'||!r.enriched_on)){
    let u=r.website.startsWith('http')?r.website:'http://'+r.website;
    const home=fetchText(u,UA_STD); scanned++;
    if(home){
      for(const [field,rx] of Object.entries(SOCIAL)){
        if(r[field]) continue;
        const m=rx.exec(home);
        if(m && !BAD_IG.has(String(m[1]).toLowerCase())){ r[field]=m[1]; gained++; }
      }
      if(!r.schedule_url){
        for(const p of SUBPATHS){
          const body=fetchText(u.replace(/\/$/,'')+'/'+p,UA_STD,10);
          if(!body) continue;
          const txt=body.replace(/<[^>]+>/g,' ');
          const times=(txt.match(/\b(1[0-2]|[1-9])(:[0-5]\d)?\s*(am|pm)\b/gi)||[]).length;
          const days=new Set((txt.match(/\b(mon|tue|wed|thu|fri|sat|sun)/gi)||[]).map(x=>x.toLowerCase())).size;
          if(times>=8&&days>=3){ r.schedule_url=u.replace(/\/$/,'')+'/'+p;
            r.schedule_signal={times,days,path:p}; gained++; break; }
        }
      }
    }
  }
  // 3. remember that we looked, even when we found nothing
  r.enriched_on=now;
  if(!(r.website||r.instagram||r.facebook||r.email)){ r.no_online_presence=true; marked++; }

  // CHECKPOINT every 15 camps. A run that dies at 90% must not lose 90% of its work.
  if(scanned && scanned % 15 === 0){
    d.last_enriched=now;
    fs.writeFileSync(DIR, JSON.stringify(d,null,1));
    process.stderr.write(`  ...checkpoint: ${scanned} fetches, ${gained} new fields\n`);
  }
}
d.last_enriched=now;
fs.writeFileSync(DIR, JSON.stringify(d,null,1));
const n=f=>entries.filter(([,r])=>r[f]).length;
console.log(`scanned ${scanned} fetches | new fields ${gained} | camps with no presence ${marked}`);
console.log(`website ${n('website')} | instagram ${n('instagram')} | facebook ${n('facebook')} | email ${n('email')} | schedule_url ${n('schedule_url')}`);
console.log(`ig verified live ${n('instagram_display_name')} | ig dormant ${n('instagram_dormant')} | ig unresolved ${n('instagram_unresolved')}`);
JS
