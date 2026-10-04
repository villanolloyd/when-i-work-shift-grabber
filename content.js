(() => {
const HOVER_DELAY_MS = 120;
const CONFIRM_POLL_MS = 100;
const CONFIRM_WAIT_MS = 3000;
const RESULT_POLL_MS = 100;
const RESULT_WAIT_MS = 2000;
const NEXT_SHIFT_DELAY_MS = 250;

const D={enabled:false,shiftStart:"11:00",shiftEnd:"22:00",breakLunchEnabled:true,break1Start:"14:00",break1End:"14:30",lunchStart:"17:00",lunchEnd:"18:00",break2Start:"20:00",break2End:"20:30",autoConfirm:false,autoRefresh:true,refreshSeconds:5,fastPollEnabled:true,fastPollInterval:1,excludedDates:[]};
const E={state:"disabled",lastScan:null,scanCount:0,refreshCount:0,lastAction:null,refreshPaused:false,processedShifts:0,totalShifts:0,attempts:0};
let settings={...D},status={...E},refreshTimer=null,scanTimer=null,mutationTimer=null,quickPollTimer=null;
let refreshInProgress=false,scanRunning=false,grabFlowActive=false,lastActionAt=0,flowId=0,quickPollBackoff=0,quickPollErrors=0;
let fullRefreshElapsedMs=0,lastRefreshClockAt=0;
let awaitingManualConfirm=false;
const norm=v=>(v||"").replace(/\s+/g," ").trim();

function parseTime(v){const m=norm(v).match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);if(!m)return null;let h=+m[1],mi=+m[2],p=m[3]?.toUpperCase();if(p==="AM"&&h===12)h=0;if(p==="PM"&&h!==12)h+=12;return h>23||mi>59?null:h*60+mi}
function parseRangesFromText(t){const a=[],r=/((\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?))/gi;let m;while((m=r.exec(norm(t)))){let s=parseTime(m[1].split(/[-–—]/)[0]),e=parseTime(m[1].split(/[-–—]/)[1]);if(s==null||e==null)continue;if(e<s)e+=1440;a.push({start:s,end:e,label:m[0]})}return a}
function vis(e){if(!e)return false;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.display!=="none"&&c.visibility!=="hidden"&&c.opacity!=="0"}
function txtOf(node){return norm(node?.innerText||node?.textContent||node?.value)}
function save(p={}){status={...status,...p};chrome.storage.local.set({status})}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function exclusionRanges(scheduleStart){
  if(settings.breakLunchEnabled===false)return [];
  const pairs=[[settings.break1Start,settings.break1End],[settings.lunchStart,settings.lunchEnd],[settings.break2Start,settings.break2End]];
  return pairs.map(([a,b])=>{
    let s=parseTime(a),e=parseTime(b);
    if(s==null||e==null||s===e)return null;
    if(e<s)e+=1440;
    if(scheduleStart!=null&&s<scheduleStart){s+=1440;e+=1440}
    return {start:s,end:e};
  }).filter(Boolean);
}

function normalizeRange(start, end) {
  let s = start;
  let e = end;
  if (e < s) e += 1440;
  return { start: s, end: e };
}

function preferred(r){
  const prefStart=parseTime(settings.shiftStart),prefEnd=parseTime(settings.shiftEnd);
  if(prefStart==null||prefEnd==null)return true;

  const candidate=normalizeRange(r.start,r.end);
  let windowStart=prefStart,windowEnd=prefEnd;
  if(windowEnd<windowStart)windowEnd+=1440;

  if(!(candidate.start>=windowStart && candidate.end<=windowEnd))return false;

  return !exclusionRanges(windowStart).some(x=>candidate.start<x.end && candidate.end>x.start);
}
function matchesObj(x){return x.ranges.some(preferred)}

function isoLocalDate(y,m,d){
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function cardDateISO(card){
  try{
    const dateEl=card?.querySelector(".date")||card;
    const t=norm(dateEl?.innerText||dateEl?.textContent||"");
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
    const m=t.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b[^0-9]{0,10}(\d{1,2})(?:[^0-9]+(\d{4}))?/i);
    if(!m)return null;
    const mon=months[m[1].slice(0,4).toLowerCase()]||months[m[1].slice(0,3).toLowerCase()];
    const day=Number(m[2]);
    let year=m[3]?Number(m[3]):new Date().getFullYear();
    if(!mon||day<1||day>31)return null;
    if(!m[3]){
      const now=new Date(), candidate=new Date(year,mon-1,day), cutoff=new Date(now.getFullYear(),now.getMonth(),now.getDate()-60);
      if(candidate<cutoff)year++;
    }
    return isoLocalDate(year,mon,day);
  }catch{return null}
}
function isExcludedDate(card){
  const dates=Array.isArray(settings.excludedDates)?settings.excludedDates:[];
  if(!dates.length)return false;
  const d=cardDateISO(card);
  return !!d&&dates.includes(d);
}

function getCards(){
  return [...document.querySelectorAll("div.shift-card")]
    .filter(vis)
    .filter(card=>!isExcludedDate(card))
    .map(card=>({card,ranges:parseRangesFromText(txtOf(card))}))
    .filter(x=>x.ranges.length);
}

function getTakeButton(card){
  if(!card) return null;
  const exact=card.querySelector('button[data-testid^="take-openshift-"]');
  if(exact) return exact;
  const classButtons=[...card.querySelectorAll('button.btn.btn-primary.btn-sm, .btn.btn-primary.btn-sm')];
  const byClass=classButtons.find(b=>/^take\s*shift$/i.test(txtOf(b)) || (b.getAttribute("data-testid")||"").startsWith("take-openshift-"));
  if(byClass) return byClass;
  return [...card.querySelectorAll("button,.btn")].find(b=>/^take\s*shift$/i.test(txtOf(b)))||null;
}

function activateHover(card,button){
  try{card.scrollIntoView({block:"center",inline:"center",behavior:"auto"})}catch{}
  const targets=[card,button].filter(Boolean);
  for(const target of targets){
    for(const t of ["pointerover","pointerenter","mouseover","mouseenter","mousemove"]){
      try{target.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}))}catch{}
    }
  }
  const state=button?{display:button.style.display,visibility:button.style.visibility,opacity:button.style.opacity,pointerEvents:button.style.pointerEvents,wasVisible:vis(button)}:null;
  if(button&&!vis(button)){
    try{
      button.style.setProperty("display","inline-block","important");
      button.style.setProperty("visibility","visible","important");
      button.style.setProperty("opacity","1","important");
      button.style.setProperty("pointer-events","auto","important");
    }catch{}
  }
  return state;
}

function clickElement(el){
  if(!el||el.disabled||el.getAttribute("aria-disabled")==="true")return false;
  try{el.focus({preventScroll:true})}catch{}
  try{el.click();status.attempts=(status.attempts||0)+1;save({attempts:status.attempts});return true}catch{}
  try{el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));status.attempts=(status.attempts||0)+1;save({attempts:status.attempts});return true}catch{return false}
}

function visibleNotifications(){
  return [...document.querySelectorAll("[role='alert'],[class*='toast'],[class*='notification'],[class*='alert']")]
    .filter(vis)
    .map(el=>({el,text:txtOf(el),key:txtOf(el).toLowerCase()}))
    .filter(x=>x.key);
}
function getShiftNotification(baseline=new Set()){
  for(const n of visibleNotifications()){
    if(baseline.has(n.key))continue;
    const nt=n.key;
    const failures=['this shift was already taken','already taken','shift has been taken','has been taken','no longer available',"couldn't be taken",'cannot be taken','unavailable'];
    if(failures.some(x=>nt.includes(x)))return {found:true,success:false,text:n.text};
    const successes=['successfully taken','taken successfully','you have taken',"you've taken",'taken by you','shift taken successfully'];
    if(successes.some(x=>nt.includes(x)))return {found:true,success:true,text:n.text};
    return {found:true,success:null,text:n.text};
  }
  return {found:false};
}

function getVisibleDialog(){
  return [...document.querySelectorAll('.dialog-kit')].find(d=>vis(d)&&/take\s*open\s*shift/i.test(txtOf(d))) || [...document.querySelectorAll('.dialog-kit')].find(vis) || null;
}
function getConfirmButton(){
  const dialog=getVisibleDialog();
  if(!dialog)return null;
  const exact=dialog.querySelector('button.btn.btn-primary.ml-2.btn-md, .btn.btn-primary.ml-2.btn-md');
  if(exact&&/take\s*openshift/i.test(txtOf(exact)))return exact;
  const candidates=[...dialog.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit']")].filter(vis);
  return candidates.find(e=>/^take\s*openshift$/i.test(txtOf(e)))||candidates.find(e=>/take\s*openshift/i.test(txtOf(e)))||null;
}

function isPageLoadedEnough(){
  try{
    if(document.readyState==='complete')return true;
    return [...document.querySelectorAll('div.shift-card')].some(vis);
  }catch{return false}
}
function safeReload(maxAttempts=10,intervalMs=1000){
  if(!settings.enabled||!settings.autoRefresh||grabFlowActive||awaitingManualConfirm)return;
  const doReload=()=>{
    if(!settings.enabled||!settings.autoRefresh||grabFlowActive||awaitingManualConfirm)return;
    save({refreshCount:(status.refreshCount||0)+1,refreshPaused:false,lastAction:'Refreshing schedule'});
    try{location.reload()}catch{}
  };
  if(isPageLoadedEnough()){doReload();return}
  let attempts=0;
  const id=setInterval(()=>{
    attempts++;
    if(isPageLoadedEnough()){clearInterval(id);doReload();return}
    if(attempts>=maxAttempts){clearInterval(id);save({lastAction:'Reload aborted: page did not finish loading'})}
  },intervalMs);
}

function findNextUnattempted(hits){
  if(Array.isArray(hits)){
    for(const h of hits){if(h.ranges&&matchesObj(h)&&h.card?.isConnected&&h.card.dataset.whAttempted!=='1')return {item:h,hits}}
  }
  const fresh=getCards().filter(matchesObj);
  for(const h of fresh){if(h.card.dataset.whAttempted!=='1')return {item:h,hits:fresh}}
  return null;
}

function moveToNextShift(hits){
  if(awaitingManualConfirm)return;
  const next=findNextUnattempted(hits);
  if(next?.item){
    save({lastAction:`Proceeding to next shift: ${next.item.ranges[0]?.label||'matching shift'}`,refreshPaused:true});
    setTimeout(()=>{if(!grabFlowActive&&!awaitingManualConfirm)grab(next.item,next.hits)},NEXT_SHIFT_DELAY_MS);
  }else if(settings.autoRefresh){
    save({refreshPaused:false,lastAction:'All matching shift cards processed — refreshing page'});
    safeReload(10,1000);
  }else{
    save({refreshPaused:false,lastAction:'All matching shift cards processed'});
  }
}

async function waitForConfirmButton(id){
  const deadline=Date.now()+CONFIRM_WAIT_MS;
  while(id===flowId&&Date.now()<deadline){
    const btn=getConfirmButton();
    if(btn)return btn;
    await sleep(CONFIRM_POLL_MS);
  }
  return null;
}

async function waitForShiftNotification(id,baseline){
  const deadline=Date.now()+RESULT_WAIT_MS;
  while(id===flowId&&Date.now()<deadline){
    const result=getShiftNotification(baseline);
    if(result.found)return result;
    await sleep(RESULT_POLL_MS);
  }
  return {found:false};
}

async function grab(item,hits){
  if(grabFlowActive||awaitingManualConfirm||!item?.card?.isConnected)return;
  grabFlowActive=true;
  const id=++flowId;
  lastActionAt=Date.now();

  try{item.card.dataset.whAttempted='1'}catch{}
  status.totalShifts=(hits&&hits.length)||status.totalShifts||0;
  status.processedShifts=(status.processedShifts||0)+1;
  save({
    refreshPaused:true,
    processedShifts:status.processedShifts,
    totalShifts:status.totalShifts,
    lastAction:`Processing ${status.processedShifts}/${status.totalShifts}: ${item.ranges[0].label}`
  });

  activateHover(item.card,null);
  await sleep(HOVER_DELAY_MS);
  if(id!==flowId)return;

  let button=getTakeButton(item.card);
  if(!button){
    grabFlowActive=false;
    save({lastAction:`${status.processedShifts}/${status.totalShifts}: Take Shift did not appear after hover — next card`});
    setTimeout(()=>moveToNextShift(hits),NEXT_SHIFT_DELAY_MS);
    return;
  }

  const notificationBaseline=new Set(visibleNotifications().map(x=>x.key));
  activateHover(item.card,button);
  await sleep(40);
  if(id!==flowId)return;
  button=getTakeButton(item.card)||button;
  if(!clickElement(button)){
    grabFlowActive=false;
    save({lastAction:`${status.processedShifts}/${status.totalShifts}: Could not click Take Shift — next card`});
    setTimeout(()=>moveToNextShift(hits),NEXT_SHIFT_DELAY_MS);
    return;
  }

  save({lastAction:`${status.processedShifts}/${status.totalShifts}: Take Shift clicked — waiting for Take OpenShift dialog`,refreshPaused:true});

  const confirmBtn=await waitForConfirmButton(id);
  if(id!==flowId)return;

  if(!confirmBtn){
    grabFlowActive=false;
    save({lastAction:`${status.processedShifts}/${status.totalShifts}: Take OpenShift dialog not found — next card`});
    setTimeout(()=>moveToNextShift(hits),NEXT_SHIFT_DELAY_MS);
    return;
  }

  if(!settings.autoConfirm){
    awaitingManualConfirm=true;
    grabFlowActive=false;
    save({refreshPaused:true,lastAction:'Take Open Shift dialog is open — waiting for manual confirmation'});
    return;
  }

  if(!clickElement(confirmBtn)){
    grabFlowActive=false;
    save({lastAction:`${status.processedShifts}/${status.totalShifts}: Could not click TAKE OPENSHIFT — next card`});
    setTimeout(()=>moveToNextShift(hits),NEXT_SHIFT_DELAY_MS);
    return;
  }

  const remainingAfterConfirm=findNextUnattempted(hits);
  if(remainingAfterConfirm?.item){
    save({refreshPaused:true,lastAction:`${status.processedShifts}/${status.totalShifts}: TAKE OPENSHIFT clicked — moving directly to next matching shift`});
    grabFlowActive=false;
    setTimeout(()=>moveToNextShift(hits),NEXT_SHIFT_DELAY_MS);
    return;
  }

  save({refreshPaused:true,lastAction:`${status.processedShifts}/${status.totalShifts}: TAKE OPENSHIFT clicked on final matching shift — waiting for notification`});

  const result=await waitForShiftNotification(id,notificationBaseline);
  if(id!==flowId)return;

  if(result.found){
    if(result.success===true){
      save({refreshPaused:true,lastAction:`${status.processedShifts}/${status.totalShifts}: Shift taken successfully — next card`});
    }else if(result.success===false){
      save({refreshPaused:true,lastAction:`${status.processedShifts}/${status.totalShifts}: ${result.text.slice(0,120)} — next card`});
    }else{
      save({refreshPaused:true,lastAction:`${status.processedShifts}/${status.totalShifts}: Notification received: ${result.text.slice(0,100)} — next card`});
    }
  }else{
    save({refreshPaused:true,lastAction:`${status.processedShifts}/${status.totalShifts}: No notification after ${RESULT_WAIT_MS/1000}s — next card`});
  }

  grabFlowActive=false;
  setTimeout(()=>moveToNextShift(hits),NEXT_SHIFT_DELAY_MS);
}

function scan(){
  if(!settings.enabled||scanRunning)return;
  scanRunning=true;
  try{
    if(awaitingManualConfirm){
      if(getVisibleDialog()){
        save({state:'monitoring',lastScan:Date.now(),refreshPaused:true,lastAction:'Waiting for manual Take Open Shift confirmation'});
        return;
      }
      awaitingManualConfirm=false;
      save({lastAction:'Manual confirmation dialog closed — resuming monitoring'});
    }
    const all=getCards();
    const hit=all.filter(matchesObj);
    status.scanCount=(status.scanCount||0)+1;
    save({
      state:'monitoring',lastScan:Date.now(),scanCount:status.scanCount,
      totalShifts:hit.length,
      refreshPaused:hit.length>0||grabFlowActive,
      lastAction:hit.length?(grabFlowActive?status.lastAction:`Found ${hit.length} preferred shift(s) — starting sequence`):'Scanning available open shifts...'
    });
    if(hit.length&&!grabFlowActive&&Date.now()-lastActionAt>=500){
      const next=findNextUnattempted(hit);
      if(next?.item)grab(next.item,next.hits);
    }
  }finally{scanRunning=false}
}

async function quickCheck(){
  if(!settings.fastPollEnabled||!settings.autoRefresh||grabFlowActive||awaitingManualConfirm||!settings.enabled)return scheduleNextQuickCheck();
  try{
    const resp=await fetch(location.href,{credentials:'same-origin',cache:'no-store',mode:'same-origin'});
    if(!resp.ok){quickPollErrors++;if(quickPollErrors>3)quickPollBackoff=Math.min(30,(quickPollBackoff||1)*2);return scheduleNextQuickCheck()}
    quickPollErrors=0;quickPollBackoff=0;
    const text=await resp.text();
    const doc=new DOMParser().parseFromString(text,'text/html');
    const parsed=[...doc.querySelectorAll('div.shift-card')].filter(n=>!isExcludedDate(n)).map(n=>({ranges:parseRangesFromText(n.textContent||'')})).filter(x=>x.ranges.length);
    const matches=parsed.filter(p=>p.ranges.some(preferred));
    if(matches.length){save({lastAction:`Fast-poll detected ${matches.length} matching shift(s) — reloading page`});safeReload(10,1000);return}
  }catch{quickPollErrors++;quickPollBackoff=Math.min(30,(quickPollBackoff||1)*2)}
  scheduleNextQuickCheck();
}
function scheduleNextQuickCheck(){
  if(quickPollTimer)clearTimeout(quickPollTimer);
  if(!settings.fastPollEnabled||!settings.autoRefresh||!settings.enabled)return;
  const base=Math.max(0.5,Number(settings.fastPollInterval)||1),jitter=Math.random()*0.3-0.15,backoff=quickPollBackoff||0;
  quickPollTimer=setTimeout(quickCheck,Math.max(200,(base+jitter+backoff)*1000));
}
function stopQuickPoll(){if(quickPollTimer)clearTimeout(quickPollTimer);quickPollTimer=null;quickPollBackoff=0;quickPollErrors=0}

function hasVisibleLoadingIndicator(){
  try{
    const nodes=[...document.querySelectorAll("body *")];
    return nodes.some(el=>{
      if(!vis(el))return false;
      const t=(el.textContent||"").replace(/\s+/g," ").trim();
      if(t.length>20||el.children.length>3)return false;
      return /^loading(?:\s*(?:\.{1,3}|…))?$/i.test(t);
    });
  }catch{return false}
}

function refreshClockTick(){
  if(!settings.enabled||!settings.autoRefresh){
    fullRefreshElapsedMs=0;
    lastRefreshClockAt=Date.now();
    return;
  }

  const now=Date.now();
  if(!lastRefreshClockAt)lastRefreshClockAt=now;
  const delta=Math.max(0,now-lastRefreshClockAt);
  lastRefreshClockAt=now;

  if(hasVisibleLoadingIndicator()){
    fullRefreshElapsedMs=0;
    return;
  }

  if(grabFlowActive||awaitingManualConfirm||refreshInProgress)return;

  fullRefreshElapsedMs+=delta;
  const targetMs=Math.max(2,Number(settings.refreshSeconds)||2)*1000;
  if(fullRefreshElapsedMs>=targetMs){
    fullRefreshElapsedMs=0;
    refreshTick();
  }
}

function refreshTick(){
  if(!settings.enabled||!settings.autoRefresh||refreshInProgress||awaitingManualConfirm)return;
  if(grabFlowActive){save({refreshPaused:true,lastAction:'Grab flow active — refresh skipped'});return}
  const all=getCards(),hit=all.filter(matchesObj);
  if(hit.length){save({refreshPaused:true,totalShifts:hit.length,lastAction:`Preferred shifts available (${hit.length}) — refresh skipped`});scan();return}
  refreshInProgress=true;
  save({refreshPaused:false,lastAction:'Refresh interval reached — checking schedule'});
  setTimeout(()=>{
    refreshInProgress=false;
    if(!settings.enabled||!settings.autoRefresh||grabFlowActive||awaitingManualConfirm)return;
    const latest=getCards().filter(matchesObj);
    if(latest.length){save({refreshPaused:true,totalShifts:latest.length,lastAction:'Preferred shifts appeared — refresh cancelled'});scan();return}
    safeReload(10,1000);
  },250);
}

function stop(){
  if(refreshTimer)clearInterval(refreshTimer);
  if(scanTimer)clearInterval(scanTimer);
  if(mutationTimer)clearTimeout(mutationTimer);
  stopQuickPoll();
  refreshTimer=scanTimer=mutationTimer=null;
  refreshInProgress=false;grabFlowActive=false;awaitingManualConfirm=false;fullRefreshElapsedMs=0;lastRefreshClockAt=0;flowId++;
}
function start(){
  stop();
  if(!settings.enabled){save({state:'disabled',refreshPaused:false,lastAction:'Auto-grab is OFF'});return}
  scanTimer=setInterval(scan,750);
  fullRefreshElapsedMs=0;
  lastRefreshClockAt=Date.now();
  refreshTimer=setInterval(refreshClockTick,250);
  setTimeout(scan,250);
  if(settings.fastPollEnabled&&settings.autoRefresh)scheduleNextQuickCheck();
}

chrome.storage.onChanged.addListener(c=>{
  let restart=false;
  for(const [k,v] of Object.entries(c)){
    if(k==='status'){status={...E,...(v.newValue||{})};continue}
    settings[k]=v.newValue;
    restart=true;
  }
  if(restart)start();
});
new MutationObserver(()=>{
  if(!settings.enabled||mutationTimer)return;
  mutationTimer=setTimeout(()=>{mutationTimer=null;scan()},80);
}).observe(document.documentElement,{subtree:true,childList:true});
chrome.storage.local.get({...D,status:E},s=>{settings={...D,...s};status={...E,...(s.status||{})};start()});
})();
