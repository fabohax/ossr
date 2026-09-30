const invoke = window.__TAURI__?.core?.invoke;
const $ = (id) => document.getElementById(id);
const config = {
  relayUrl: localStorage.getItem('relayUrl') || 'http://127.0.0.1:3002',
  nodeUrl: localStorage.getItem('nodeUrl') || 'http://127.0.0.1:20443',
  referenceUrl: localStorage.getItem('referenceUrl') || 'https://api.testnet.hiro.so',
};
let serviceState;

function badge(id, label, kind) { const el=$(id); el.textContent=label; el.className=`badge ${kind}`; }
function value(id, next, fallback='—') { $(id).textContent = next ?? fallback; }
function formatNumber(next) {
  if (next == null) return '—';
  if (typeof next === 'string' && /^-?\d+$/.test(next)) return BigInt(next).toLocaleString();
  return Number(next).toLocaleString();
}
function formatUptime(seconds) { if(seconds==null)return '— uptime'; const h=Math.floor(seconds/3600); const d=Math.floor(h/24); return d ? `${d}d ${h%24}h uptime` : `${h}h uptime`; }
function setNotice(message) { $('notice').textContent=message; $('notice').classList.toggle('hidden', !message); }

function render(snapshot) {
  const good=snapshot.overall==='healthy'; const relayGood=snapshot.relay.live.reachable; const ready=snapshot.relay.ready.reachable;
  $('overall-pill').className=`pill ${good?'good':snapshot.overall==='degraded'?'warn':'bad'}`;
  $('overall-pill').innerHTML=`<i class="dot ${good?'green':''}"></i>${snapshot.overall.toUpperCase()}`;
  value('last-updated',`Updated ${new Date(snapshot.checkedAt).toLocaleTimeString()}`);
  value('hero-title',good?'All systems operational':snapshot.overall==='degraded'?'Operator attention needed':'Relay is offline');
  value('hero-copy',good?'The relay is ready and its Stacks follower reports a complete testnet sync.':'One or more required services are unavailable or still synchronizing.');
  const readyCount=[relayGood,ready,snapshot.node.health.reachable,snapshot.node.fullySynced].filter(Boolean).length;
  value('hero-score',`${readyCount}/4`);
  badge('relay-badge',relayGood?'LIVE':'OFFLINE',relayGood?'good':'bad'); value('relay-state',relayGood?(ready?'Ready':'Live, not ready'):'Unreachable'); value('relay-latency',snapshot.relay.live.latencyMs==null?'—':`${snapshot.relay.live.latencyMs} ms`);
  const nodeGood=snapshot.node.health.reachable; badge('node-badge',nodeGood?'ONLINE':'OFFLINE',nodeGood?'good':'bad'); value('node-state',nodeGood?'Follower connected':'Follower unavailable'); value('node-detail',snapshot.node.serverVersion||snapshot.node.health.detail); value('tip-height',formatNumber(snapshot.node.stacksTipHeight));
  const synced=snapshot.node.fullySynced===true; badge('sync-badge',synced?'SYNCED':nodeGood?'SYNCING':'UNKNOWN',synced?'good':nodeGood?'warn':'bad'); value('sync-state',synced?'Fully synchronized':nodeGood?'Synchronization in progress':'Cannot determine sync'); value('sync-detail',snapshot.node.referenceTipHeight==null?'Public reference unavailable':`Public tip ${formatNumber(snapshot.node.referenceTipHeight)}`); value('blocks-behind',formatNumber(snapshot.node.blocksBehind));
  value('network',snapshot.relay.network||'Testnet'); value('relay-id',snapshot.relay.relayId); value('sponsor',snapshot.relay.sponsorPrincipal); value('balance',snapshot.relay.sponsorBalanceMicroStx==null?null:`${(Number(snapshot.relay.sponsorBalanceMicroStx)/1e6).toLocaleString(undefined,{maximumFractionDigits:6})} STX`);
  value('quotes',snapshot.relay.quotesEnabled==null?null:snapshot.relay.quotesEnabled?'Enabled':'Disabled'); value('sponsorships',snapshot.relay.sponsorshipsEnabled==null?null:snapshot.relay.sponsorshipsEnabled?'Enabled':'Disabled'); badge('readiness',ready?'READY':'NOT READY',ready?'good':'bad');
  value('uptime',formatUptime(snapshot.relay.uptimeSeconds)); value('requests',formatNumber(snapshot.relay.requestsTotal)); value('broadcasts',formatNumber(snapshot.relay.broadcasts)); value('confirmations',formatNumber(snapshot.relay.confirmations)); value('rejections',formatNumber(snapshot.relay.rejections)); value('sats-earned',snapshot.relay.satsEarned==null?null:`${formatNumber(snapshot.relay.satsEarned)} sats`);
  const total=(snapshot.relay.broadcasts||0)+(snapshot.relay.rejections||0); $('success-bar').style.width=total?`${Math.round(100*(snapshot.relay.broadcasts||0)/total)}%`:'0';
}

async function refresh() {
  $('refresh').classList.add('spin'); setNotice('');
  try {
    if (!invoke) throw new Error('Run this interface through the Tauri desktop application.');
    render(await invoke('get_snapshot',{relayUrl:config.relayUrl,nodeUrl:config.nodeUrl,referenceUrl:config.referenceUrl}));
    await refreshServices();
  } catch(error) { setNotice(String(error)); $('overall-pill').className='pill bad'; $('overall-pill').textContent='CHECK FAILED'; }
  finally { $('refresh').classList.remove('spin'); }
}
async function refreshServices(){ serviceState=await invoke('get_autostart_status'); value('relay-service',serviceState.relay.state); value('dashboard-service',serviceState.dashboard.state); $('autostart').disabled=!serviceState.relay.installed||!serviceState.dashboard.installed; $('autostart').checked=serviceState.relay.enabled&&serviceState.dashboard.enabled; $('toggle-relay').disabled=!serviceState.relay.installed; $('toggle-relay').textContent=serviceState.relay.active?'Stop relay':'Start relay'; }
$('refresh').addEventListener('click',refresh);
$('install').addEventListener('click',()=>{ $('relay-directory').value=localStorage.getItem('relayDirectory')||''; $('install-dialog').showModal(); });
$('confirm-install').addEventListener('click',async(event)=>{ event.preventDefault(); const relayDirectory=$('relay-directory').value.trim(); try{ serviceState=await invoke('install_autostart',{relayDirectory});localStorage.setItem('relayDirectory',relayDirectory);$('install-dialog').close();await refreshServices();setNotice('');}catch(error){setNotice(String(error));$('install-dialog').close();} });
$('autostart').addEventListener('change',async(event)=>{try{await invoke('set_autostart',{enabled:event.target.checked});await refreshServices();}catch(error){setNotice(String(error));await refreshServices();}});
$('toggle-relay').addEventListener('click',async()=>{try{await invoke('set_relay_running',{running:!serviceState.relay.active});await refreshServices();setTimeout(refresh,800);}catch(error){setNotice(String(error));}});
refresh(); setInterval(refresh,15000);
