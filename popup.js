const D={enabled:false,shiftStart:"11:00",shiftEnd:"22:00",breakLunchEnabled:true,break1Start:"14:00",break1End:"14:30",lunchStart:"17:00",lunchEnd:"18:00",break2Start:"20:00",break2End:"20:30",autoConfirm:false,autoRefresh:true,refreshSeconds:2,fastPollEnabled:true,fastPollInterval:1,excludedDates:[],status:{}};
const $=id=>document.getElementById(id);
const fmt=t=>t?new Date(t).toLocaleTimeString([],{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—";

function render(s={}){
  const active=s.state==="monitoring";
  $("state").textContent=active?"AUTO-GRAB ON":"AUTO-GRAB OFF";
  $("statusPill").textContent=active?"Monitoring":"Inactive";
  $("statusPill").className="status-pill"+(active?" on":"");
  $("lastScan").textContent=fmt(s.lastScan);
  $("refreshCount").textContent=s.refreshCount??0;
  $("processed").textContent=s.processedShifts??0;
  $("totalShifts").textContent=s.totalShifts??0;
  $("lastAction").textContent=s.lastAction||"—";
}

let excludedDates=[];

function renderExcludedDates(){
  const box=$("excludedDatesList");
  if(!box)return;
  box.innerHTML="";
  if(!excludedDates.length){
    box.innerHTML='<div class="toggle-help">No excluded dates.</div>';
    return;
  }
  [...excludedDates].sort().forEach(date=>{
    const row=document.createElement("div");
    row.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:7px 8px;margin-top:5px;background:#f8fafc;border:1px solid #eef2f6;border-radius:8px";
    const label=document.createElement("span");
    label.textContent=date;
    const remove=document.createElement("button");
    remove.textContent="Remove";
    remove.style.cssText="border:0;background:transparent;color:#b42318;font:inherit;font-weight:650;cursor:pointer";
    remove.onclick=()=>{
      excludedDates=excludedDates.filter(d=>d!==date);
      renderExcludedDates();
      chrome.storage.local.set({excludedDates});
    };
    row.append(label,remove);
    box.appendChild(row);
  });
}

function load(){
  chrome.storage.local.get(D,s=>{
    $("enabled").checked=!!s.enabled;
    $("shiftStart").value=s.shiftStart||"11:00";
    $("shiftEnd").value=s.shiftEnd||"22:00";
    $("breakLunchEnabled").checked=s.breakLunchEnabled!==false;
    $("break1Start").value=s.break1Start||"14:00";
    $("break1End").value=s.break1End||"14:30";
    $("lunchStart").value=s.lunchStart||"17:00";
    $("lunchEnd").value=s.lunchEnd||"18:00";
    $("break2Start").value=s.break2Start||"20:00";
    $("break2End").value=s.break2End||"20:30";
    $("autoConfirm").checked=!!s.autoConfirm;
    $("autoRefresh").checked=s.autoRefresh!==false;
    $("refreshSeconds").value=s.refreshSeconds||5;
    $("fastPollEnabled").checked=s.fastPollEnabled!==false;
    $("fastPollInterval").value=s.fastPollInterval||1;
    excludedDates=Array.isArray(s.excludedDates)?s.excludedDates:[];
    renderExcludedDates();
    render(s.status);
  });
}

$("save").onclick=()=>{
  const seconds=Math.min(60,Math.max(2,Number($("refreshSeconds").value)||5));
  const fpInterval=Math.max(0.5,Number($("fastPollInterval").value)||1);

  chrome.storage.local.set({
    enabled:$("enabled").checked,
    shiftStart:$("shiftStart").value,
    shiftEnd:$("shiftEnd").value,
    breakLunchEnabled:$("breakLunchEnabled").checked,
    break1Start:$("break1Start").value,
    break1End:$("break1End").value,
    lunchStart:$("lunchStart").value,
    lunchEnd:$("lunchEnd").value,
    break2Start:$("break2Start").value,
    break2End:$("break2End").value,
    autoConfirm:$("autoConfirm").checked,
    autoRefresh:$("autoRefresh").checked,
    refreshSeconds:seconds,
    fastPollEnabled:$("fastPollEnabled").checked,
    fastPollInterval:fpInterval,
    excludedDates
  },()=>{
    const button=$("save");
    button.textContent="Saved ✓";
    setTimeout(()=>button.textContent="Save settings",1000);
  });
};

$("addExcludeDate").onclick=()=>{
  const d=$("excludeDate").value;
  if(!d)return;
  if(!excludedDates.includes(d))excludedDates.push(d);
  excludedDates.sort();
  $("excludeDate").value="";
  renderExcludedDates();
  chrome.storage.local.set({excludedDates});
};

$("resetCounters").onclick=()=>{
  chrome.storage.local.get({status:{}},r=>{
    const status={...(r.status||{}),refreshCount:0,processedShifts:0,totalShifts:0};
    chrome.storage.local.set({status},()=>{
      render(status);
      const button=$("resetCounters");
      button.textContent="Reset ✓";
      setTimeout(()=>button.textContent="Reset page refresh & processing",1000);
    });
  });
};

chrome.storage.onChanged.addListener(c=>{
  if (c.excludedDates) {
    excludedDates = Array.isArray(c.excludedDates.newValue)
      ? c.excludedDates.newValue
      : [];
    renderExcludedDates();
  }
  if (c.status) render(c.status.newValue);
});

setInterval(()=>chrome.storage.local.get({status:{}},r=>render(r.status)),1000);
load();
