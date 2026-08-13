/* ═══════════════════════════════════════════════════════════════
   Hermes Studio · v0.30 深化融合模块（独立脚本，动态挂载）
   覆盖/新增：群聊修复 · 房间共享记忆 · 工作流页 · 知识图谱 ·
   轨迹(技能统计) · 评测 · MBTI测试 · 记忆深化(蒸馏/反思) ·
   Guardrails · 模型冒烟 · 用量模型分组 · UI 合并(删隧道/通讯+连接器)
   全部以 Hermes 为底座。不修改 v0.21 原有逻辑，只叠加/覆盖。
   ═══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
if(window.__fusionV030Loaded) return;
window.__fusionV030Loaded = true;

/* ── 工具 ── */
function esc30(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function toast30(msg,type){ if(window.toast){ try{ window.toast(msg,type); return; }catch(e){} } if(window.alert) alert(msg); }
function api30(path,method,body){
  method=method||"GET";
  var headers={"Content-Type":"application/json"};
  if(window.monitorToken) headers["X-Monitor-Token"]=window.monitorToken;
  var opts={method:method,headers:headers,cache:"no-store"};
  if(body) opts.body=JSON.stringify(body);
  var base=(typeof window.apiUrl==="function")?window.apiUrl(path):path;
  return fetch(base,opts).then(function(r){ return r.json().catch(function(){ return {}; }); });
}
function fmt30(ts){ if(!ts) return ""; var d=new Date(ts); return ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2); }
function fmtDate30(ts){ if(!ts) return ""; var d=new Date(ts); return (d.getMonth()+1)+"月"+d.getDate()+"日 "+fmt30(ts); }
function el30(tag,html,cls){ var e=document.createElement(tag); if(html!=null) e.innerHTML=html; if(cls) e.className=cls; return e; }
function modal30(title,bodyHTML,footHTML){
  var ov=el30("div",'<div class="modal-overlay" style="position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)this.remove()">'+
    '<div class="modal" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);width:100%;max-width:620px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2)">'+
    '<div class="modal-head" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0"><h3 style="margin:0;font-size:16px">'+esc30(title)+'</h3><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;font-size:20px;color:var(--text3)">×</button></div>'+
    '<div class="modal-body" style="padding:16px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:12px">'+bodyHTML+'</div>'+
    (footHTML?'<div class="modal-foot" style="display:flex;justify-content:flex-end;gap:10px;padding:14px 16px;border-top:1px solid var(--border);flex-shrink:0">'+footHTML+'</div>':'')+
    '</div></div>');
  document.body.appendChild(ov);
  return ov;
}
function btn30(label,onclick,primary){
  var b=el30("button",esc30(label),"btn"+(primary?" primary":""));
  b.onclick=onclick;
  return b;
}

/* ═══ 1. UI 合并：删隧道 · 删重复工作流入口 · 连接器并入通讯 · 轨迹并入知识库 ═══ */
function uiMerge(){
  try{
    // 删除导航按钮：隧道(用户要求移除) / 工作流(扩展页已有完整 Tab，误加的重复入口) /
    //             连接器(并入通讯页：上部通讯+下部连接器) / 轨迹learning(并入知识库页)
    document.querySelectorAll('.nav-btn').forEach(function(b){
      var oc=b.getAttribute('onclick')||'';
      if(oc.indexOf("'tunnel'")>=0||oc.indexOf("'flows'")>=0||oc.indexOf("'connectors'")>=0||oc.indexOf("'learning'")>=0){ b.remove(); }
    });
    var pt=document.getElementById('page-tunnel'); if(pt) pt.style.display='none';
    // 页面路由重定向：旧入口 → 合并后的目标页
    if(window.switchPage){
      var _orig=window.switchPage;
      window.switchPage=function(name){
        if(name==='tunnel'||name==='connectors') name='comm';   // 连接器 → 通讯（下部连接器区）
        if(name==='learning') name='kb';                        // 轨迹 → 知识库（轨迹 Tab）
        if(name==='flows') name='extensions';                   // 工作流 → 扩展（原工作流 Tab）
        return _orig(name);
      };
    }
  }catch(e){}
}
// 工作流页容器（由 switchPage('flows') 触发渲染，页面由 fusion 动态创建）
function ensureFlowsPage(){
  var p=document.getElementById('page-flows');
  if(p) return p;
  p=el30("section",'<div class="page-header"><h1>工作流</h1><button class="ov-actbtn" onclick="renderFlowsPage()" style="margin-left:auto">↻ 刷新</button><button class="ov-actbtn" onclick="flowCreateDialog()">＋ 新建工作流</button></div>'+
    '<div class="page-body"><div class="card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden"><div id="flowList" style="padding:0"></div></div></div>',"page");
  p.id="page-flows";
  var anchor=document.getElementById('page-rooms');
  if(anchor&&anchor.parentNode) anchor.parentNode.insertBefore(p,anchor.nextSibling);
  return p;
}
function renderFlowsPage(){
  ensureFlowsPage();
  var box=document.getElementById('flowList'); if(!box) return;
  box.innerHTML='<div style="padding:16px;color:var(--muted);font-size:13px">加载中…</div>';
  api30('/api/flows').then(function(r){
    var flows=(r&&r.flows)||[];
    if(!flows.length){ box.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted)">暂无工作流<br><span style="font-size:12px">「＋ 新建工作流」编排多 Agent 步骤（DAG），每步调用 Hermes 会话执行</span></div>'; return; }
    box.innerHTML='';
    flows.forEach(function(f){
      var row=el30("div",'<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)">'+
        '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;color:var(--text)">'+esc30(f.name)+'</div>'+
        '<div style="font-size:11px;color:var(--muted);margin-top:2px">'+f.steps.length+' 步 · '+(f.steps.map(function(s){return s.status;}).join(" / "))+'</div></div>'+
        '<span style="font-size:11px;padding:2px 10px;border-radius:10px;background:'+(f.status==='running'?'var(--accent-bg);color:var(--accent)':f.status==='done'?'rgba(34,197,94,.12);color:var(--success-text)':f.status==='failed'?'var(--red-bg);color:var(--red)':'var(--bg3);color:var(--text2)')+'">'+esc30(f.status||'idle')+'</span>'+
        '<button class="btn sm" onclick="flowDetail(\''+f.id+'\')">查看</button>'+
        '<button class="btn sm primary" onclick="flowRun(\''+f.id+'\')">▶ 运行</button>'+
        '<button class="btn sm" style="color:var(--red)" onclick="flowDelete(\''+f.id+'\')">删除</button></div>');
      box.appendChild(row);
    });
  });
}
function flowCreateDialog(){
  var ov=modal30("新建工作流",
    '<input id="fName" placeholder="工作流名称" style="width:100%;padding:8px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text)">'+
    '<div style="font-size:12.5px;font-weight:600;color:var(--text)">步骤（每行一个：名称 | 专家提示词；依赖用 &gt; 前缀，如 "&gt;步骤1"）</div>'+
    '<textarea id="fSteps" rows="10" placeholder="调研 | 调研主题并输出要点\n&gt;调研 | 基于要点撰写完整报告\n评审 | 用一句话点评报告质量" style="width:100%;font-family:var(--font);font-size:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);padding:10px;line-height:1.6"></textarea>'+
    '<div style="font-size:11.5px;color:var(--muted)">语法：<b>名称 | 提示词</b>（首行无依赖）；依赖上一行用 <b>&gt;名称</b>。每步使用独立 Hermes 会话，依赖步骤输出自动拼入上下文。</div>',
    '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button><button class="btn primary" onclick="flowCreateConfirm()">创建</button>');
}
function flowCreateConfirm(){
  var name=(document.getElementById('fName').value||'').trim()||('工作流 '+new Date().toLocaleTimeString());
  var lines=(document.getElementById('fSteps').value||'').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var steps=[]; var prev=null;
  lines.forEach(function(l){
    var dep=false;
    if(l.indexOf('>')===0){ dep=true; l=l.slice(1).trim(); }
    var i=l.indexOf('|');
    var sname=(i>0?l.slice(0,i):l).trim()||('步骤'+(steps.length+1));
    var prompt=(i>0?l.slice(i+1):l).trim();
    steps.push({name:sname,prompt:prompt,depends_on:dep&&prev?[prev]:[]});
    prev=sname;
  });
  if(!steps.length){ toast30('请输入至少一个步骤','error'); return; }
  api30('/api/flows','POST',{name:name,steps:steps}).then(function(r){
    var ov=document.querySelector('.modal-overlay'); if(ov) ov.remove();
    if(r&&r.ok){ toast30('工作流已创建','success'); renderFlowsPage(); }
    else toast30('创建失败: '+((r&&r.error)||''),'error');
  });
}
function flowDetail(id){
  api30('/api/flows/'+encodeURIComponent(id)).then(function(r){
    var f=(r&&r.flow)||null; if(!f) return;
    var rows=f.steps.map(function(s){
      var res=(f.results||{})[s.name]||{};
      var st=res.status||'pending';
      return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12.5px">'+
        '<div style="display:flex;align-items:center;gap:8px"><b style="color:var(--text)">'+esc30(s.name)+'</b>'+
        '<span style="font-size:10.5px;padding:1px 8px;border-radius:8px;background:'+(st==='success'?'rgba(34,197,94,.12);color:var(--success-text)':st==='failed'?'var(--red-bg);color:var(--red)':st==='running'?'var(--accent-bg);color:var(--accent)':'var(--bg3);color:var(--text2)')+'">'+esc30(st)+'</span>'+
        (res.latency_ms?'<span style="color:var(--muted);font-size:11px">'+(res.latency_ms/1000).toFixed(1)+'s</span>':'')+'</div>'+
        (s.depends_on&&s.depends_on.length?'<div style="font-size:11px;color:var(--accent);margin-top:2px">依赖: '+s.depends_on.map(esc30).join(', ')+'</div>':'')+
        '<div style="font-size:11px;color:var(--muted);margin-top:2px">'+esc30(s.prompt.slice(0,80))+'</div>'+
        (res.output?'<div style="font-size:11.5px;color:var(--text2);margin-top:6px;background:var(--bg1);border-radius:6px;padding:8px;white-space:pre-wrap;max-height:140px;overflow-y:auto">'+esc30(res.output.slice(0,600))+'</div>':'')+
        (res.error?'<div style="font-size:11px;color:var(--red);margin-top:4px">'+esc30(res.error)+'</div>':'')+
        '</div>';
    }).join('');
    modal30("工作流："+f.name, rows, '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">关闭</button>');
  });
}
function flowRun(id){
  toast30('工作流已开始运行（后台执行）');
  api30('/api/flows/'+encodeURIComponent(id)+'/run','POST',{}).then(function(r){
    setTimeout(renderFlowsPage,3000);
  });
}
function flowDelete(id){
  if(!confirm('删除该工作流？')) return;
  api30('/api/flows/'+encodeURIComponent(id),'DELETE').then(function(){ renderFlowsPage(); });
}

/* ═══ 2. 群聊修复：@成员 空态提示（覆盖 v0.25 的 roomAtDialog） ═══ */
window.roomAtDialog=function(){
  if(!currentRoom){ toast30('请先在左侧选择或创建群聊房间','error'); return; }
  var room=(typeof roomsStore!=="undefined"&&roomsStore)?roomsStore.find(function(x){return String(x.id)===String(currentRoom);}):null;
  if(!room){ toast30('房间数据未加载，请稍后重试','error'); return; }
  if(!(room.members||[]).length){ toast30('该房间暂无专家成员，请先「＋ 新建房间」时勾选专家','error'); return; }
  var membersHtml=room.members.map(function(m){
    var on=typeof roomAt!=="undefined"&&roomAt.has(m.key);
    return '<label class="room-ck"><input type="checkbox" value="'+m.key+'"'+(on?' checked':'')+' style="accent-color:var(--accent)"><span>'+(m.emoji||'🧠')+' '+esc30(m.label)+'</span></label>';
  }).join('');
  modal30("@ 成员（可多选，并行回复）", membersHtml+'<div style="font-size:11.5px;color:var(--muted)">不选择任何成员 = 主 Hermes 回复</div>',
    '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button><button class="btn primary" onclick="roomAtDialogConfirm()">确定</button>');
};
window.roomAtDialogConfirm=function(){
  if(typeof roomAt!=="undefined") roomAt.clear();
  document.querySelectorAll('.modal-overlay input:checked').forEach(function(cb){ if(typeof roomAt!=="undefined") roomAt.add(cb.value); });
  var ov=document.querySelector('.modal-overlay'); if(ov) ov.remove();
  if(typeof roomRenderAtBar==="function") roomRenderAtBar();
  toast30('已设置 @ 成员','success');
};

/* ═══ 3. 房间共享记忆（L5） ═══ */
function roomMemoryDialog(){
  if(!currentRoom){ toast30('请先选择房间','error'); return; }
  var room=(typeof roomsStore!=="undefined"&&roomsStore)?roomsStore.find(function(x){return String(x.id)===String(currentRoom);}):null;
  if(!room) return;
  api30('/api/rooms/'+encodeURIComponent(currentRoom)+'/memory').then(function(r){
    var mems=(r&&r.memories)||[];
    var list=mems.length?mems.slice(-30).reverse().map(function(m){
      return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;font-size:12px"><div style="color:var(--muted);font-size:10.5px;margin-bottom:3px">'+esc30(m.from||'')+' · '+fmtDate30(m.ts)+'</div><div style="color:var(--text2)">'+esc30(m.text)+'</div></div>';
    }).join(''):'<div style="color:var(--muted);font-size:12px;text-align:center;padding:16px">房间共享记忆为空</div>';
    var ov=modal30("🧠 房间共享记忆（成员可读）",
      '<textarea id="rmMemText" rows="3" placeholder="记录一条共识/结论，所有成员后续会话都会看到…" style="width:100%;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);padding:8px;font-size:12.5px"></textarea>'+
      '<div style="font-size:11.5px;color:var(--muted)">💡 你发的消息会自动沉淀到共享记忆，成员回复时会参考这些记忆。</div>'+
      '<div style="font-size:11.5px;color:var(--muted)">已存 '+mems.length+' 条：</div>'+list,
      '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">关闭</button><button class="btn primary" onclick="roomMemoryAdd()">＋ 记录</button>');
  });
}
function roomMemoryAdd(){
  var text=(document.getElementById('rmMemText').value||'').trim();
  if(!text){ toast30('请输入内容','error'); return; }
  api30('/api/rooms/'+encodeURIComponent(currentRoom)+'/memory','POST',{text:text,from:'我'}).then(function(r){
    if(r&&r.ok){ toast30('已记录到房间共享记忆','success'); roomMemoryDialog(); }
    else toast30('记录失败','error');
  });
}
// 群聊输入区加"共享记忆"按钮
function addRoomMemBtn(){
  var atBtn=null;
  document.querySelectorAll('#page-rooms button').forEach(function(b){
    if(b.textContent.indexOf('@ 成员')>=0) atBtn=b;
  });
  if(atBtn&&!document.getElementById('roomMemBtn')){
    var b=btn30("🧠 记忆",roomMemoryDialog);
    b.id="roomMemBtn"; b.className="btn";
    atBtn.parentNode.insertBefore(b,atBtn.nextSibling);
  }
}

/* ═══ 4. 知识页：Tab（树/图谱）+ 轨迹区 ═══ */
function kbFusionMount(){
  var kbPage=document.getElementById('page-kb');
  if(!kbPage) return;
  // 锁定知识库内部布局（文件树左+内容右）；注意：不可覆盖 .page 的 display 隐藏
  if(!document.getElementById('kbLayoutFix')){
    var st=document.createElement('style'); st.id='kbLayoutFix';
    st.textContent='#kbLayout{display:flex !important;flex-direction:row !important;align-items:stretch}#page-kb .page-body{display:flex;flex-direction:column;flex:1;min-height:0}';
    document.head.appendChild(st);
  }
  if(document.getElementById('kbFusionTabs')) return;
  var header=kbPage.querySelector('.page-header');
  if(header){
    var tabs=el30("div",'<button class="exp-tab active" data-kbt="tree" onclick="kbTabSwitch(\'tree\')">📂 文档树</button>'+
      '<button class="exp-tab" data-kbt="graph" onclick="kbTabSwitch(\'graph\')">🕸️ 知识图谱</button>'+
      '<button class="exp-tab" data-kbt="trace" onclick="kbTabSwitch(\'trace\')">📈 轨迹（技能使用）</button>');
    tabs.id="kbFusionTabs"; tabs.style.cssText="display:flex;gap:6px;margin:0 0 10px";
    header.after(tabs);
  }
  var graphWrap=el30("div",'<div id="kbGraphBox" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;min-height:320px;display:none;margin-bottom:14px"><div style="color:var(--muted);font-size:13px;text-align:center;padding:60px 0" id="kbGraphMsg">加载图谱…</div><svg id="kbGraphSvg" width="100%" height="400" style="display:none"></svg></div>');
  var traceWrap=el30("div",'<div id="kbTraceBox" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;min-height:160px;display:none;margin-bottom:14px"></div>');
  // 插入到 kbLayout 前（v0.21 无 .page-body，用 kbLayout 作锚点）
  var anchor=document.getElementById('kbLayout')||kbPage.querySelector('.kb-layout');
  var body=kbPage.querySelector('.page-body');
  if(body){ body.insertBefore(graphWrap,body.firstChild); body.insertBefore(traceWrap,graphWrap); }
  else if(anchor){ kbPage.insertBefore(graphWrap, anchor); kbPage.insertBefore(traceWrap, graphWrap); }
  else { kbPage.appendChild(graphWrap); kbPage.appendChild(traceWrap); }
  // 「收录记忆」按钮：把 Hermes 记忆沉淀进知识库
  var hdr=kbPage.querySelector('.page-header');
  if(hdr && !document.getElementById('kbImportMemBtn')){
    var btn=el30("button","📥 收录记忆","ov-actbtn");
    btn.id="kbImportMemBtn";
    btn.onclick=function(){
      api30('/api/kb/import-memory','POST',{}).then(function(r){
        if(r&&r.ok){ toast30('已收录 '+(r.imported||[]).length+' 个记忆文件','success'); if(typeof kbLoadTree==="function") kbLoadTree(); }
        else toast30('收录失败: '+((r&&r.error)||''),'error');
      }).catch(function(e){ toast30('收录失败: '+e.message,'error'); });
    };
    hdr.appendChild(btn);
  }
}
function kbTabSwitch(t){
  try{
    ['tree','graph','trace'].forEach(function(k){
      var b=document.querySelector('[data-kbt="'+k+'"]'); if(b) b.classList.toggle('active',k===t);
    });
    // v0.21 知识页容器是 #kbLayout（非 .kb-layout）
    var treeWrap=document.getElementById('kbLayout');
    var graphBox=document.getElementById('kbGraphBox'), traceBox=document.getElementById('kbTraceBox');
    if(t==='tree'){ if(typeof kbLoadTree==="function") kbLoadTree(); if(treeWrap){ treeWrap.style.display=''; treeWrap.style.removeProperty('display'); } }
    else if(treeWrap){ treeWrap.style.setProperty('display','none','important'); }
    if(graphBox) graphBox.style.display=(t==='graph')?'':'none';
    if(traceBox) traceBox.style.display=(t==='trace')?'':'none';
    if(t==='graph'&&typeof kbGraphLoad==="function") kbGraphLoad();
    if(t==='trace'&&typeof kbTraceLoad==="function") kbTraceLoad();
  }catch(e){}
}
function kbGraphLoad(){
  var box=document.getElementById('kbGraphBox'); if(!box) return;
  var msg=document.getElementById('kbGraphMsg'); var svg=document.getElementById('kbGraphSvg');
  api30('/api/kb/graph').then(function(r){
    var nodes=(r&&r.nodes)||[], links=(r&&r.links)||[];
    if(!nodes.length){ msg.style.display=''; msg.textContent='知识库为空，图谱暂无内容（在文档中写入 [链接](other.md) 可形成图谱）'; svg.style.display='none'; return; }
    msg.style.display='none'; svg.style.display='';
    svg.innerHTML='';
    var W=svg.clientWidth||760, H=400;
    var pos={};
    // 无链接时环形布局（整齐不重叠）；有链接时力导向
    if(!links.length){
      var R=Math.min(W,H)/2-45;
      nodes.forEach(function(n,i){ var a=(2*Math.PI*i)/nodes.length-Math.PI/2; pos[n.id]={x:W/2+Math.cos(a)*R,y:H/2+Math.sin(a)*R}; });
    } else {
      nodes.forEach(function(n,i){ pos[n.id]={x:W/2+(Math.random()-0.5)*W*0.6,y:H/2+(Math.random()-0.5)*H*0.6}; });
      for(var it=0;it<60;it++){
        links.forEach(function(l){
          var a=pos[l.source],b=pos[l.target]; if(!a||!b) return;
          var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-90)*0.02;
          a.x+=dx/d*f; a.y+=dy/d*f; b.x-=dx/d*f; b.y-=dy/d*f;
        });
        nodes.forEach(function(n){
          var p=pos[n.id]; p.x+=(W/2-p.x)*0.01; p.y+=(H/2-p.y)*0.01;
        });
      }
    }
    var colors={}; var pal=['#5e64f3','#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6','#14b8a6'];
    var ci=0; nodes.forEach(function(n){ if(!colors[n.category]){ colors[n.category]=pal[ci++%pal.length]; } });
    links.forEach(function(l){
      var a=pos[l.source],b=pos[l.target]; if(!a||!b) return;
      var line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x); line.setAttribute('y1',a.y); line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
      line.setAttribute('stroke','var(--border)'); line.setAttribute('stroke-width','1');
      svg.appendChild(line);
    });
    nodes.forEach(function(n){
      var p=pos[n.id]; if(!p) return;
      var g=document.createElementNS('http://www.w3.org/2000/svg','g');
      g.setAttribute('transform','translate('+p.x+','+p.y+')');
      var c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('r','14'); c.setAttribute('fill',colors[n.category]||'#888'); c.setAttribute('opacity','0.85');
      var t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('text-anchor','middle'); t.setAttribute('y','-18'); t.setAttribute('font-size','10');
      t.setAttribute('fill','var(--text2)'); t.textContent=n.label.length>10?n.label.slice(0,10)+'…':n.label;
      g.appendChild(c); g.appendChild(t);
      g.style.cursor='pointer';
      g.addEventListener('click',function(){
        // 打开对应笔记（v0.21: kbOpenNote(path)）
        var rel=n.id.replace(/\.md$/i,'')+'.md';
        if(typeof kbOpenNote==="function"){ try{ kbOpenNote(rel); }catch(e){} }
        else if(typeof kbOpenFile==="function"){ try{ kbOpenFile(rel); }catch(e){} }
      });
      svg.appendChild(g);
    });
  }).catch(function(){ msg.style.display=''; msg.textContent='图谱加载失败'; svg.style.display='none'; });
}
function kbTraceLoad(){
  var box=document.getElementById('kbTraceBox'); if(!box) return;
  box.innerHTML='<div style="color:var(--muted);font-size:13px">加载轨迹…</div>';
  Promise.all([api30('/api/skills/usage'),api30('/api/trace?limit=100')]).then(function(res){
    var usage=res[0]||{}, trace=res[1]||{};
    var skills=(usage.skills||[]);
    var events=(trace.events||[]).filter(function(e){ return e.kind==='chat_request'; });
    var html='<div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:8px">📈 技能使用统计（共 '+(usage.total||0)+' 次）</div>';
    if(!skills.length){ html+='<div style="color:var(--muted);font-size:12px;padding:8px 0">暂无技能调用记录（工具调用会自动统计）</div>'; }
    else{
      html+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">'+skills.slice(0,20).map(function(s){
        return '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--accent-bg);color:var(--accent);font-size:11px;padding:3px 10px;border-radius:12px">'+esc30(s.skill)+' ×'+s.count+'</span>';
      }).join('')+'</div>';
    }
    html+='<div style="font-weight:600;font-size:13px;color:var(--text);margin:10px 0 8px">🕐 运行轨迹（最近 '+events.length+' 次对话）</div>';
    if(!events.length){ html+='<div style="color:var(--muted);font-size:12px;padding:8px 0">暂无运行记录（对话后自动产生）</div>'; }
    else{
      html+='<div style="display:flex;flex-direction:column;gap:4px">'+events.map(function(e){
        return '<div style="display:flex;gap:8px;align-items:center;font-size:11.5px;padding:5px 8px;border-radius:6px;background:var(--bg1)">'+
          '<span style="color:var(--muted);flex-shrink:0">'+fmtDate30(e.ts)+'</span>'+
          '<span class="tag gray" style="flex-shrink:0">'+esc30(e.model||'auto')+'</span>'+
          '<span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc30(String(e.session_id||'').slice(0,14))+'</span>'+
          '<span style="color:var(--muted);margin-left:auto;flex-shrink:0">'+e.message_len+'字</span></div>';
      }).join('')+'</div>';
    }
    box.innerHTML=html;
  });
}

/* ═══ 5. 通讯页：把 v0.21 原版连接器页整体并入（上部通讯+下部连接器，版面一致） ═══ */
function commFusionMount(){
  var commPage=document.getElementById('page-comm');
  var pc=document.getElementById('page-connectors');
  if(!commPage||!pc) return;
  var body=commPage.querySelector('.page-body');
  if(!body) return;
  // 已移动则跳过
  if(pc.parentNode===body && pc.getAttribute('data-merged')==='1') return;
  // 在通讯页内容后插入分隔标题 + 原版连接器 section
  var sep=el30("div",'<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)"><h2 style="font-size:16px;margin:0 0 10px">连接器</h2></div>');
  body.appendChild(sep);
  pc.setAttribute('data-merged','1');
  // 保留 .page 类（选择器 #page-connectors 仍生效），用 inline 覆盖 display 与 padding
  pc.style.cssText="display:block;margin:0;padding:0;background:transparent;box-shadow:none";
  body.appendChild(pc);
  // 进入通讯页时同时渲染连接器（由 boot 的 switchPage 钩子统一处理）
}

/* ═══ 6. 记忆页：daily + 蒸馏 + 反思候选/自进化 ═══ */
function memoryFusionMount(){
  var memPage=document.getElementById('page-memory');
  if(!memPage||document.getElementById('memFusionBox')) return;
  var body=memPage.querySelector('.page-body'); if(!body) return;
  var wrap=el30("div",'<div id="memFusionBox" style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
    '<button class="btn primary" onclick="memDistill()">🌌 一键蒸馏记忆（Deep Dream）</button>'+
    '<button class="btn" onclick="memLoadDaily()">📅 查看每日记忆</button>'+
    '<button class="btn" onclick="memLoadEvolution()">🔄 自进化记录</button></div>'+
    '<div id="memFusionBody"></div></div>');
  body.appendChild(wrap);
}
function memDistill(){
  if(!confirm('蒸馏将用 LLM 合并 MEMORY.md 与最近 14 天日记并覆写（自动备份，可回滚）。继续？')) return;
  var box=document.getElementById('memFusionBody'); if(box) box.innerHTML='<div style="color:var(--muted);font-size:13px">🌌 正在蒸馏（调用模型合并记忆，约 30-120 秒）…</div>';
  api30('/api/memory/distill','POST',{}).then(function(r){
    if(r&&r.ok) box.innerHTML='<div style="font-size:12.5px;line-height:1.8"><span style="color:var(--success-text)">✅ 蒸馏完成</span><br>备份: <span class="mono" style="font-size:11px">'+esc30(r.backup||'')+'</span><br>新 MEMORY.md 开头:<br><pre style="background:var(--bg1);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11.5px;white-space:pre-wrap">'+esc30(r.distilled||'')+'</pre></div>';
    else box.innerHTML='<div style="color:var(--red);font-size:13px">蒸馏失败: '+esc30((r&&r.error)||'')+'</div>';
  }).catch(function(e){ box.innerHTML='<div style="color:var(--red);font-size:13px">'+esc30(e.message)+'</div>'; });
}
function memLoadDaily(){
  var box=document.getElementById('memFusionBody'); if(!box) return;
  box.innerHTML='<div style="color:var(--muted);font-size:13px">加载…</div>';
  api30('/api/memory/daily').then(function(r){
    var files=(r&&r.files)||[];
    if(!files.length){ box.innerHTML='<div style="color:var(--muted);font-size:13px">暂无每日记忆（每天对话后自动记录摘要）</div>'; return; }
    box.innerHTML=files.map(function(f){
      return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px"><div style="font-weight:600;font-size:12.5px;color:var(--text)">📅 '+esc30(f.date)+'</div><pre style="font-size:11.5px;color:var(--text2);white-space:pre-wrap;margin-top:4px">'+esc30(f.content.slice(0,400))+(f.content.length>400?'…':'')+'</pre></div>';
    }).join('');
  });
}
function memLoadEvolution(){
  var box=document.getElementById('memFusionBody'); if(!box) return;
  box.innerHTML='<div style="color:var(--muted);font-size:13px">加载…</div>';
  api30('/api/evolution').then(function(r){
    var html='';
    if(r&&r.curator_state) html+='<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px"><div style="font-weight:600;font-size:12.5px;color:var(--text)">🤖 Curator 状态</div><pre style="font-size:11px;color:var(--text2);white-space:pre-wrap;margin-top:4px">'+esc30(String(r.curator_state).slice(0,400))+'</pre></div>';
    var reports=(r&&r.reports)||[];
    html+='<button class="btn" style="margin-bottom:8px" onclick="memCuratorRun()">▶ 立即运行自进化</button>';
    if(!reports.length&&!html){ box.innerHTML='<div style="color:var(--muted);font-size:13px">暂无自进化记录</div>'; return; }
    html+=reports.map(function(rep){
      return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px"><div style="font-weight:600;font-size:12.5px;color:var(--text)">🔄 '+esc30(rep.file)+'</div><pre style="font-size:11px;color:var(--text2);white-space:pre-wrap;margin-top:4px">'+esc30(rep.content.slice(0,500))+'</pre></div>';
    }).join('');
    box.innerHTML=html;
  });
}
window.memCuratorRun=function(){
  var box=document.getElementById('memFusionBody'); if(!box) return;
  box.innerHTML='<div style="color:var(--muted);font-size:13px">⏳ 正在运行 Curator 自进化（后台执行，稍后刷新查看记录）…</div>';
  api30('/api/memory/curator/run','POST',{}).then(function(r){
    if(r&&r.ok){ toast30('自进化已启动（后台运行）','success'); setTimeout(function(){ memLoadEvolution(); }, 4000); }
    else toast30('启动失败: '+((r&&r.error)||''),'error');
  }).catch(function(e){ toast30('启动失败: '+e.message,'error'); });
}

/* ═══ 7. 模型页：测试按钮（L7 冒烟） ═══ */
function modelsFusionMount(){
  var modelsPage=document.getElementById('page-models');
  if(!modelsPage||document.getElementById('modelSmokeBox')) return;
  var body=modelsPage.querySelector('.page-body'); if(!body) return;
  var wrap=el30("div",'<div id="modelSmokeBox" style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">'+
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
    '<span style="font-weight:600;font-size:13px;color:var(--text)">🧪 模型冒烟测试</span>'+
    '<select id="smokeModel" style="min-width:180px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text)"></select>'+
    '<button class="btn primary" onclick="modelSmokeRun()">▶ 跑 5 条用例</button></div>'+
    '<div id="modelSmokeResult" style="font-size:12.5px;color:var(--muted)">添加/切换模型后，一键验证模型可用性，直接消灭"加了模型用不了"。</div></div>');
  body.appendChild(wrap);
}
function modelSmokeFill(){
  var sel=document.getElementById('smokeModel'); if(!sel) return;
  var prevVal=sel.value; // 保留用户当前选择（周期重填不重置）
  // 同步优先：用 v0.21 已加载的 _cfg（与模型卡片同一数据源）
  var ps=((typeof _cfg!=="undefined"&&_cfg&&_cfg.providers)||[]);
  if(!ps.length && typeof _cfg==="undefined"){
    // 兜底：异步拉取
    api30('/api/config').then(function(r){ ps=(r&&(r.providers||r.ymlProviders))||[]; render(); });
    return;
  }
  render();
  function render(){
    var html='';
    ps.forEach(function(p){
      var models=(p.models&&p.models.length)?p.models:[p.model].filter(Boolean);
      if(!models.length) models=['auto'];
      models.forEach(function(md){
        // 兼容对象数组（{id,name,...}）与字符串数组
        var mid=(typeof md==='string')?md:(md&&(md.id||md.model||md.name)||'');
        var mlabel=(typeof md==='string')?md:(md&&(md.name||md.id||md.model)||mid);
        if(mid) html+='<option value="'+esc30(mid)+'">'+esc30(mlabel)+'（'+esc30(p.name||p.id)+'）</option>';
      });
    });
    if(html){
      sel.innerHTML=html;
      // 恢复用户之前的选择（若还在列表中）
      if(prevVal){
        var found=false;
        for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===prevVal){ found=true; break; } }
        if(found) sel.value=prevVal;
      }
    }
  }
}
function modelSmokeRun(){
  var sel=document.getElementById('smokeModel'); if(!sel||!sel.value){ toast30('请先选择模型','error'); return; }
  var box=document.getElementById('modelSmokeResult'); if(!box) return;
  box.innerHTML='<div style="color:var(--muted)">⏳ 正在运行 5 条冒烟用例（基础回复/中文/数学/代码/指令遵循）…</div>';
  api30('/api/eval/smoke','POST',{model:sel.value}).then(function(r){
    if(!r||!r.results){ box.innerHTML='<div style="color:var(--red)">测试失败: '+esc30((r&&r.error)||'')+'</div>'; return; }
    var html='<div style="font-weight:600;margin-bottom:8px;color:'+(r.pass_rate>=80?'var(--success-text)':r.pass_rate>=50?'var(--warning-dark)':'var(--red)')+'">通过 '+r.passed+'/'+r.total+'（'+(r.pass_rate||0)+'%）</div>';
    html+=r.results.map(function(c){
      return '<div style="display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:6px;background:var(--bg1);margin-bottom:4px;font-size:12px">'+
        '<span style="'+(c.passed?'color:var(--success-text)':'color:var(--red)')+'">'+(c.passed?'✅':'❌')+'</span>'+
        '<b style="color:var(--text);flex-shrink:0">'+esc30(c.name)+'</b>'+
        '<span style="color:var(--muted);flex-shrink:0">'+((c.latency_ms||0)/1000).toFixed(1)+'s</span>'+
        '<span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc30(c.output||c.error||'')+'</span></div>';
    }).join('');
    box.innerHTML=html;
  }).catch(function(e){ box.innerHTML='<div style="color:var(--red)">'+esc30(e.message)+'</div>'; });
}

/* ═══ 8. 用量页：模型分组（覆盖 renderUsagePage） ═══ */
var __origRenderUsage=window.renderUsagePage;
window.renderUsagePage=function(){
  // 先跑原始（含会话列表），随后叠加模型分组
  if(typeof __origRenderUsage==="function"){ try{ __origRenderUsage(); }catch(e){} }
  api30('/api/usage').then(function(r){
    var u=(r&&r.usage)||{};
    var byModel=u.by_model||{};
    var wrap=document.getElementById('usageModelWrap');
    if(!wrap){
      var page=document.getElementById('page-usage');
      var body=page?page.querySelector('.page-body'):null;
      if(!body) return;
      wrap=el30("div",'<div id="usageModelWrap" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px"><div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:8px">📊 按模型统计</div><div id="usageModelGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px"></div></div>');
      body.appendChild(wrap);
    }
    var grid=document.getElementById('usageModelGrid');
    var keys=Object.keys(byModel);
    if(!keys.length){ grid.innerHTML='<div style="grid-column:1/-1;color:var(--muted);font-size:12.5px">暂无模型统计数据</div>'; return; }
    grid.innerHTML=keys.map(function(k){
      var v=byModel[k]||{};
      return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px">'+
        '<div style="font-weight:600;font-size:13px;color:'+(k==='unknown'?'var(--muted)':'var(--text)')+'">'+esc30(k)+'</div>'+
        '<div style="font-size:11px;color:var(--muted);margin-top:4px">'+v.sessions+' 会话 · '+v.messages+' 条消息</div></div>';
    }).join('');
  });
};

/* ═══ 9. 设置页：Guardrails（L3） ═══ */
function settingsFusionMount(){
  var setPage=document.getElementById('page-settings');
  if(!setPage||document.getElementById('guardrailBox')) return;
  var body=setPage.querySelector('.page-body'); if(!body) return;
  var wrap=el30("div",'<div id="guardrailBox" style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">'+
    '<div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:10px">🛡️ Guardrails 安全护栏</div>'+
    '<div style="display:flex;flex-direction:column;gap:8px;max-width:520px">'+
    '<div class="setting-row" style="display:flex;align-items:center;gap:12px;padding:8px 0"><div style="flex:1"><div class="label">输入隐私拦截</div><div class="desc" style="font-size:11.5px;color:var(--muted)">SSN/信用卡/API Key 等敏感信息阻止外发</div></div><div class="toggle" id="grPrivacy" onclick="guardrailToggle(this)" data-key="privacy"><span class="toggle-switch"></span></div></div>'+
    '<div class="setting-row" style="display:flex;align-items:center;gap:12px;padding:8px 0"><div style="flex:1"><div class="label">输出脱敏</div><div class="desc" style="font-size:11.5px;color:var(--muted)">回复中自动 [redacted] 掩码</div></div><div class="toggle" id="grRedact" onclick="guardrailToggle(this)" data-key="redact_output"><span class="toggle-switch"></span></div></div>'+
    '<div class="setting-row" style="display:flex;align-items:center;gap:12px;padding:8px 0"><div style="flex:1"><div class="label">允许访问内网/私网 URL</div><div class="desc" style="font-size:11.5px;color:var(--muted)">关闭更安全</div></div><div class="toggle" id="grPrivate" onclick="guardrailToggle(this)" data-key="hermes_allow_private"><span class="toggle-switch"></span></div></div>'+
    '<div style="display:flex;gap:8px;margin-top:6px"><button class="btn primary" onclick="guardrailSave()">保存</button></div></div>'+
    '<div style="font-size:11px;color:var(--muted);margin-top:8px">隐私拦截/脱敏在对话层生效；内网 URL 开关写入 Hermes config（security.allow_private_urls）。</div></div>');
  body.appendChild(wrap);
  api30('/api/guardrails').then(function(r){
    var c=(r&&r.config)||{};
    var map={privacy:!!c.privacy, redact_output:!!c.redact_output, hermes_allow_private:!!c.hermes_allow_private};
    ['grPrivacy','grRedact','grPrivate'].forEach(function(id){
      var el=document.getElementById(id); if(!el) return;
      var on=map[el.getAttribute('data-key')];
      if(on) el.classList.add('on');
    });
  });
}
window.guardrailToggle=function(el){ if(el) el.classList.toggle('on'); }
function guardrailSave(){
  function on(id){ var el=document.getElementById(id); return !!(el&&el.classList.contains('on')); }
  api30('/api/guardrails','POST',{
    privacy:on('grPrivacy'),
    redact_output:on('grRedact'),
    hermes_allow_private:on('grPrivate')
  }).then(function(r){
    if(r&&r.ok) toast30('Guardrails 已保存','success');
  });
}

/* ═══ 10. 专家页：MBTI 测试（O3） ═══ */
var MBTI_QUESTIONS=[
  {q:"聚会后你通常",a:"感觉精力充沛，还想继续",b:"感觉疲惫，需要独处恢复"},
  {q:"你更看重",a:"逻辑与一致性",b:"情感与和谐"},
  {q:"做决定时你倾向于",a:"先规划再行动",b:"边做边调整"},
  {q:"你更喜欢的工作方式",a:"专注做好一件事再换下一件",b:"同时处理多件事"},
  {q:"面对新项目",a:"先想清楚全貌再开始",b:"直接开始边做边想"},
  {q:"你更容易被",a:"事实和数据说服",b:"道理和愿景打动"},
  {q:"你的桌面/房间通常",a:"整洁有序",b:"看似混乱但心中有数"},
  {q:"社交场合中你",a:"主动开启话题",b:"等待他人来聊"},
  {q:"你更相信",a:"亲身实践的经验",b:"理论框架的推演"},
  {q:"别人评价你",a:"理性冷静",b:"温暖体贴"},
  {q:"临睡前你在想",a:"明天要做的事",b:"今天发生的事"},
  {q:"遇到分歧你倾向",a:"坚持自己的观点",b:"先考虑对方感受"},
  {q:"你更擅长",a:"按计划执行",b:"随机应变"},
  {q:"独处时你",a:"需要做事才安心",b:"享受发呆和思考"},
  {q:"你表达想法时",a:"直截了当",b:"委婉含蓄"},
  {q:"你关注",a:"细节与当下",b:"整体与未来"},
  {q:"团队合作中你",a:"喜欢带头组织",b:"喜欢配合执行"},
  {q:"面对压力你",a:"越挫越勇",b:"需要倾诉释放"},
  {q:"你整理物品",a:"用完归位",b:"随手一放"},
  {q:"别人向你求助时",a:"直接给方案",b:"先倾听共情"},
  {q:"你更喜欢的信息形式",a:"文字和数字",b:"图表和故事"},
  {q:"你的决定通常是",a:"深思熟虑",b:"凭直觉"},
  {q:"忙碌一天后你",a:"安排明天计划",b:"放松休息"},
  {q:"你觉得自己",a:"务实主义者",b:"理想主义者"},
  {q:"说话时你",a:"想好再说",b:"说了再想"},
  {q:"你更愿意",a:"稳定不变",b:"新鲜变化"},
  {q:"对不熟悉的人",a:"很快熟络",b:"需要时间熟悉"},
  {q:"你评价自己",a:"严谨自律",b:"随性洒脱"}
];
var MBTI_Q_STATE={idx:0,score:{E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0},answers:[]};
function mbtiTestDialog(){
  MBTI_Q_STATE={idx:0,score:{E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0},answers:[]};
  var ov=modal30("🧬 MBTI 人格测试（28 题）",'<div id="mbtiQ" style="font-size:14px;color:var(--text);padding:8px 0"></div>','');
  mbtiRenderQ(ov);
}
function mbtiRenderQ(ov){
  var box=document.getElementById('mbtiQ'); if(!box) return;
  var q=MBTI_QUESTIONS[MBTI_Q_STATE.idx];
  if(!q){
    // 计分
    var s=MBTI_Q_STATE.score;
    var dims=[['E','I'],['S','N'],['T','F'],['J','P']];
    var code='';
    dims.forEach(function(d){
      var a=s[d[0]]||0,b=s[d[1]]||0;
      code+=(a>=b?d[0]:d[1]);
    });
    var labels={INTJ:"建筑师",INTP:"逻辑学家",ENTJ:"指挥官",ENTP:"辩论家",INFJ:"提倡者",INFP:"调停者",ENFJ:"主人公",ENFP:"竞选者",ISTJ:"物流师",ISFJ:"守卫者",ESTJ:"总经理",ESFJ:"执政官",ISTP:"鉴赏家",ISFP:"探险家",ESTP:"企业家",ESFP:"表演者"};
    box.innerHTML='<div style="text-align:center;padding:10px"><div style="font-size:28px;margin-bottom:8px">'+esc30(code)+'</div>'+
      '<div style="font-size:16px;font-weight:700;color:var(--accent)">'+esc30((labels[code]||code))+'</div>'+
      '<div style="font-size:12.5px;color:var(--muted);margin:10px 0">这是你的 MBTI 人格，可一键以该人格创建专家会话</div>'+
      '<button class="btn primary" onclick="mbtiApplyResult(\''+code+'\')">🎭 以 '+esc30(code)+' 人格开始对话</button></div>';
    return;
  }
  box.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-size:12px;color:var(--muted)">第 '+(MBTI_Q_STATE.idx+1)+' / 28 题</span></div>'+
    '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:16px">'+esc30(q.q)+'</div>'+
    '<div style="display:flex;flex-direction:column;gap:8px">'+
    '<button class="btn" style="padding:12px;text-align:left" onclick="mbtiAnswer(0)">'+esc30(q.a)+'</button>'+
    '<button class="btn" style="padding:12px;text-align:left" onclick="mbtiAnswer(1)">'+esc30(q.b)+'</button></div>';
}
function mbtiAnswer(i){
  var q=MBTI_QUESTIONS[MBTI_Q_STATE.idx];
  var keys=[['E','I'],['S','N'],['T','F'],['J','P']];
  var dim=Math.floor(MBTI_Q_STATE.idx/7); // 每轴 7 题
  var k=keys[dim][i];
  MBTI_Q_STATE.score[k]=(MBTI_Q_STATE.score[k]||0)+1;
  MBTI_Q_STATE.idx++;
  mbtiRenderQ(null);
}
function mbtiApplyResult(code){
  document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
  if(window.chatWithPersona){
    try{
      var labelMap={INTJ:"INTJ · 建筑师",INTP:"INTJ · 逻辑学家",ENTJ:"ENTJ · 指挥官",ENTP:"ENTP · 辩论家",INFJ:"INFJ · 提倡者",INFP:"INFP · 调停者",ENFJ:"ENFJ · 主人公",ENFP:"ENFP · 竞选者",ISTJ:"ISTJ · 物流师",ISFJ:"ISFJ · 守卫者",ESTJ:"ESTJ · 总经理",ESFJ:"ESFJ · 执政官",ISTP:"ISTP · 鉴赏家",ISFP:"ISFP · 探险家",ESTP:"ESTP · 企业家",ESFP:"ESFP · 表演者"};
      var persona=(window.AGENCY_PERSONAS||[]).find(function(x){ return x.id==='mbti_'+code.toLowerCase(); });
      if(persona&&typeof window.chatWithPersona==="function"){ window.chatWithPersona(persona.id); return; }
    }catch(e){}
  }
  toast30('人格已确定: '+code+'（请从专家广场选择对应人格）','success');
}
function expertsFusionMount(){
  var expPage=document.getElementById('page-experts');
  if(!expPage||document.getElementById('mbtiTestBtn')) return;
  var header=expPage.querySelector('.page-header');
  if(header){
    var b=btn30("🧬 MBTI 人格测试",mbtiTestDialog,false);
    b.id="mbtiTestBtn"; b.style.marginLeft="auto";
    header.appendChild(b);
  }
}

/* ═══ 12. 对话页输入框 @ 专家触发（直接指定角色回答；全部专家可搜索可滚动） ═══ */
var chatAtPanelEl=null;
function chatAtRender(kw){
  var listEl=chatAtPanelEl?chatAtPanelEl.querySelector('#chatAtList'):null;
  if(!listEl) return;
  var list=el30("div",'');
  var all=(window.AGENCY_PERSONAS||[]);
  var kw2=(kw||"").toLowerCase();
  var exps=all.filter(function(x){
    if(!kw2) return true;
    return (x.label+' '+(x.desc||'')+' '+(x.dept_label||'')).toLowerCase().indexOf(kw2)>=0;
  });
  if(!exps.length){
    list.innerHTML='<div style="padding:8px;font-size:12px;color:var(--muted)">无匹配专家</div>';
  }else{
    // 渲染全部匹配项，列表可滚动下滑（不再 slice 截断）
    exps.forEach(function(x){
      var it=el30("div",'<span style="font-size:13px;flex-shrink:0">'+(x.emoji||'🧠')+'</span><span style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc30(x.label)+'</span><span style="margin-left:auto;flex-shrink:0;font-size:10px;color:var(--accent);background:var(--accent-bg);padding:0 6px;border-radius:7px">'+(x.dept_label||'')+'</span>');
      it.setAttribute('data-at','1');
      it.style.cssText="display:flex;gap:6px;align-items:center;padding:4px 8px;cursor:pointer;font-size:11.5px;border-radius:7px";
      it.onmouseenter=function(){ it.style.background='var(--accent-bg)'; };
      it.onmouseleave=function(){ it.style.background=''; };
      it.onclick=function(){ chatAtPick(x); };
      list.appendChild(it);
    });
    if(exps.length>8){
      var more=el30("div",'<span style="color:var(--muted)">共 '+exps.length+' 位 · 继续下滑查看更多</span>');
      more.style.cssText="padding:4px 8px;font-size:10.5px;text-align:center;color:var(--muted)";
      list.appendChild(more);
    }
  }
  listEl.innerHTML=''; listEl.appendChild(list);
  listEl.scrollTop=0;
}
function chatAtPanel(kw){
  var inp=document.getElementById('chatInput');
  if(!inp) return;
  if(!chatAtPanelEl){
    // 小气泡样式：窄、矮、圆角大，只露出少数几项
    chatAtPanelEl=el30("div",'<div style="padding:4px 6px;border-bottom:1px solid var(--border)"><input id="chatAtSearch" type="text" placeholder="🔍 搜索专家…" style="width:100%;padding:3px 8px;font-size:11.5px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);outline:none"></div><div id="chatAtList" style="max-height:208px;overflow-y:auto;padding:2px"></div>');
    chatAtPanelEl.style.cssText="position:absolute;bottom:100%;left:14px;width:288px;max-width:80vw;z-index:500;background:var(--bg2);border:1px solid var(--border);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.16);display:none;overflow:hidden";
    var composer=document.getElementById('chatComposer')||inp.parentNode;
    composer.style.position='relative';
    composer.appendChild(chatAtPanelEl);
    var si=chatAtPanelEl.querySelector('#chatAtSearch');
    if(si){
      si.addEventListener('input',function(){ chatAtRender(this.value); });
      si.addEventListener('keydown',function(e){
        if(e.key==='Enter'){ e.preventDefault(); var first=chatAtPanelEl.querySelector('#chatAtList [data-at]'); if(first){ first.click(); } }
        if(e.key==='Escape') closeChatAt();
      });
    }
  }
  var si2=chatAtPanelEl.querySelector('#chatAtSearch');
  if(si2){ si2.value=''; }
  chatAtRender(kw);
  chatAtPanelEl.style.display='block';
  if(si2) setTimeout(function(){ si2.focus(); },30);
}
function chatAtPick(x){
  closeChatAt();
  var inp=document.getElementById('chatInput');
  var pp=(x.prompt||x.system||'');
  // 微信风格：保留 "@专家名 " 在输入框（消息会带上 @ 谁，聊天记录可见）
  if(inp){
    var v=inp.value||'';
    var cleaned=v.replace(/@[^\s@]*\s*$/,'').trim();
    var atText='@'+(x.label||x.name||'');
    inp.value=cleaned?(cleaned+' '+atText+' '):(atText+' ');
    if(window.autoResize){try{autoResize(inp);}catch(e){}}
    try{ inp.focus(); }catch(e){}
  }
  // 直接设置 sendChat 读取的 _personaPrompt（最可靠：发送时 system 即专家提示）
  try{
    if(typeof _personaPrompt!=="undefined"){ _personaPrompt=pp; }
  }catch(e){}
  // 同时绑定 _selectedExpert（显示选用条 + injectExpertSystem 双保险）
  try{
    if(typeof _selectedExpert!=="undefined"){
      var pname=(x.emoji||'')+' '+(x.label||x.name||'');
      _selectedExpert={ id:x.id||'', name:pname, prompt:pp };
      try{
        if(window._cfg&&_cfg.extensions&&_cfg.extensions.workflow&&_cfg.extensions.workflow.enabled){ _cfg.extensions.workflow.enabled=false; _cfg.extensions.workflow.active=false; if(typeof renderWorkflowBar==="function") renderWorkflowBar(); }
        if(window._cfg&&_cfg.extensions){ _cfg.extensions.team_enabled=false; if(typeof renderTeamBar==="function") renderTeamBar(); }
      }catch(e){}
      if(typeof renderSelectedExpertBar==="function") renderSelectedExpertBar();
      var t=document.getElementById('chatTitle'); if(t) t.textContent=pname;
    }
  }catch(e){}
  toast30('已选择专家: '+(x.emoji||'')+' '+(x.label||''),'success');
}
function closeChatAt(){ if(chatAtPanelEl) chatAtPanelEl.style.display='none'; }
function chatInputAtBind(){
  var inp=document.getElementById('chatInput');
  if(!inp||inp.getAttribute('data-at-bound')) return;
  inp.setAttribute('data-at-bound','1');
  inp.addEventListener('input',function(){
    var m=(inp.value||'').match(/@([^\s@]*)$/);
    if(m){ chatAtPanel(m[1].toLowerCase()); } else closeChatAt();
  });
  inp.addEventListener('keydown',function(e){ if(e.key==='Escape') closeChatAt(); });
  document.addEventListener('click',function(e){
    if(chatAtPanelEl && e.target!==inp && !chatAtPanelEl.contains(e.target)) closeChatAt();
  });
}

/* ═══ 13. 群聊输入框：粘贴图片/附件（结构与主聊天输入框一致） ═══ */
function roomComposeBind(){
  var ta=document.getElementById('roomCompose');
  if(!ta||ta.getAttribute('data-at-bound')) return;
  ta.setAttribute('data-at-bound','1');
  ta.addEventListener('paste',function(e){
    var cd=e.clipboardData||window.clipboardData; if(!cd||!cd.items) return;
    var files=[]; for(var i=0;i<cd.items.length;i++){ var it=cd.items[i]; if(it.kind==='file'){ var f=it.getAsFile(); if(f) files.push(f); } }
    if(!files.length) return;
    e.preventDefault();
    files.forEach(function(f){ roomUploadInsert(f); });
  });
  // Enter 发送（与主输入框 Shift+Enter 换行一致）
  ta.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); roomSend(); }
  });
}
function roomAttachClick(){
  var inp=document.createElement('input'); inp.type='file'; inp.style.display='none';
  document.body.appendChild(inp);
  inp.onchange=function(){
    var f=inp.files[0]; if(!f){ document.body.removeChild(inp); return; }
    roomUploadInsert(f);
    document.body.removeChild(inp);
  };
  inp.click();
}
/* @ 成员为一次性：发送后自动清空（下次需重新 @，类似微信；多选保留） */
window.roomSend=function(){
  if(!currentRoom) return;
  var ta=document.getElementById('roomCompose'); if(!ta) return;
  var text=(ta.value||'').trim();
  if(!text) return;
  ta.value='';
  var room=(typeof roomsStore!=="undefined"&&roomsStore)?roomsStore.find(function(x){ return String(x.id)===String(currentRoom); }):null;
  var at=[];
  if(typeof roomAt!=="undefined"&&roomAt.size){
    roomAt.forEach(function(k){
      var m=(room&&room.members||[]).find(function(x){ return x.key===k; });
      if(m) at.push({ key:m.key, label:m.label, system:m.system||'', model:m.model||'', provider:'' });
    });
  }
  // 消息文本前加 @ 成员名（聊天记录里能看到这条消息 @ 了谁，微信风格）
  var sendText=text;
  if(at.length){
    sendText=at.map(function(a){ return '@'+a.label; }).join(' ')+' '+text;
  }
  api('/api/rooms/'+encodeURIComponent(currentRoom)+'/send','POST',{text:sendText,at:at}).then(function(r){
    if(!r||r.ok===false) toast('发送失败: '+((r&&r.error)||''),'error');
  }).catch(function(){});
  // 消息由后端 SSE 广播渲染（一次），这里不再本地追加，避免重复；无 @ 时后端自动开接力，状态条会显示"主持人思考中"
  // 一次性 @：发送后清空标签（下次需重新 @）
  if(typeof roomAt!=="undefined") roomAt.clear();
  if(typeof roomRenderAtBar==="function") roomRenderAtBar();
};

/* 建房弹窗：加"房间默认模型"（成员真并行建议用并发友好的快模型） */
window.roomCreateDialog=function(){
  var exps=(window.AGENCY_PERSONAS||[]);
  if(!exps.length){ toast('专家库未加载，请稍后重试','error'); return; }
  var opts=exps.slice(0,140).map(function(x){
    return '<label class="room-ck"><input type="checkbox" value="'+x.id+'" data-label="'+escapeHtml(x.label)+'" data-emoji="'+escapeHtml(x.emoji||'🧠')+'" data-prompt="'+escapeHtml(x.prompt||'')+'" style="accent-color:var(--accent)"><span>'+escapeHtml(x.emoji||'🧠')+' '+escapeHtml(x.label)+' <span style="color:var(--muted);font-size:11px">'+escapeHtml(x.dept_label||'')+'</span></span></label>';
  }).join('');
  var html='<div class="modal-overlay" id="roomCreateOverlay" onclick="if(event.target===this)this.remove()">'+
    '<div class="modal" style="max-width:560px">'+
    '<div class="modal-head"><h3>＋ 创建群聊房间</h3><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">×</button></div>'+
    '<div class="modal-body" style="padding:16px;max-height:60vh;overflow-y:auto">'+
    '<p style="font-size:12.5px;color:var(--text2);margin-bottom:12px;line-height:1.5">邀请专家成员（可多选，0 个则仅主 Hermes）。每位成员 = 独立 Hermes 会话 + 人格注入，发消息时 @ 成员并行回复。</p>'+
    '<input type="text" id="roomCreateTitle" placeholder="房间名称（默认：群聊）" style="width:100%;padding:8px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);margin-bottom:10px">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:12px;font-weight:600;color:var(--text);flex-shrink:0">房间默认模型</span>'+
    '<select id="roomCreateModel" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);font-size:12px"><option value="">默认模型</option></select></div>'+
    '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">💡 多成员并行时建议选并发友好的快模型（如 deepseek-v4-flash），可让多个专家真正同时出字。</div>'+
    '<div style="font-size:12.5px;font-weight:600;margin-bottom:8px;color:var(--text)">选择专家成员：</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;border:1px solid var(--border);border-radius:10px;padding:8px;max-height:280px;overflow-y:auto">'+opts+'</div>'+
    '</div>'+
    '<div class="modal-foot" style="padding:12px 16px;display:flex;justify-content:flex-end;gap:8px">'+
    '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>'+
    '<button class="btn primary" onclick="roomCreateConfirm()">创建房间</button>'+
    '</div></div></div>';
  var div=document.createElement('div'); div.innerHTML=html; document.body.appendChild(div.firstChild);
  api30('/api/config').then(function(r){
    var sel=document.getElementById('roomCreateModel'); if(!sel) return;
    var ps=(r&&(r.providers||r.ymlProviders))||[];
    var h='<option value="">默认模型</option>';
    ps.forEach(function(p){
      var models=(p.models&&p.models.length)?p.models:[p.model].filter(Boolean);
      models.forEach(function(md){
        // models 可能是对象数组（{id,name,...}）或字符串数组
        var mid=(typeof md==='string')?md:(md&&(md.id||md.name)||'');
        var mlabel=(typeof md==='string')?md:(md&&(md.name||md.id)||mid);
        if(mid) h+='<option value="'+mid+'">'+mlabel+'（'+(p.name||p.id)+'）</option>';
      });
    });
    sel.innerHTML=h;
  }).catch(function(){});
};
window.roomCreateConfirm=function(){
  var title=(document.getElementById('roomCreateTitle').value||'').trim()||('群聊 '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
  var model=(document.getElementById('roomCreateModel')||{}).value||'';
  var members=[];
  document.querySelectorAll('#roomCreateOverlay input:checked').forEach(function(cb){
    members.push({ key:'exp_'+cb.value, label:cb.getAttribute('data-label'), emoji:cb.getAttribute('data-emoji'), persona_id:cb.value, system:cb.getAttribute('data-prompt') });
  });
  var ov=document.getElementById('roomCreateOverlay'); if(ov) ov.remove();
  api30('/api/rooms','POST',{title:title,members:members,model:model}).then(function(r){
    if(r&&r.ok!==false){
      if(typeof roomsStore!=="undefined") roomsStore.unshift(r.room);
      renderRoomList(); selectRoom(r.room.id);
      toast30('房间已创建'+(model?'（模型:'+model+'）':''),'success');
    } else toast30('创建失败: '+((r&&r.error)||''),'error');
  }).catch(function(e){ toast30('创建失败: '+e.message,'error'); });
};

/* 微信扫码轮询容错：网络波动（网关重启窗口）自动静默重试，不再直接报 Failed to fetch */
window.chPollWeixinQr=function(qrcode, seq, retry){
  if(seq===undefined) seq=(typeof _chQrSeq!=="undefined")?_chQrSeq:0;
  retry=retry||0;
  var cur=function(){ return (typeof _chQrSeq!=="undefined")?_chQrSeq:0; };
  api('/api/channels/weixin/qr/status?qrcode='+encodeURIComponent(qrcode),'GET').then(function(res){
    if(seq!==cur()) return;
    if(!res || res.error){
      if(retry<4){ setTimeout(function(){ if(seq===cur()) window.chPollWeixinQr(qrcode, seq, retry+1); }, 2000); return; }
      var stEl=document.getElementById('wxQrStatus'); if(stEl) stEl.textContent='轮询出错：'+(res&&res.error||'未知错误');
      return;
    }
    var st=res.status;
    var stEl=document.getElementById('wxQrStatus');
    if(st==='wait'){ setTimeout(function(){ if(seq===cur()) window.chPollWeixinQr(qrcode, seq); }, 3000); }
    else if(st==='scaned'){ if(stEl) stEl.textContent='已扫码，请在微信中确认登录…'; setTimeout(function(){ if(seq===cur()) window.chPollWeixinQr(qrcode, seq); }, 3000); }
    else if(st==='expired'){ var body=document.getElementById('chModalBody'); if(body) body.innerHTML='<div class="conn-hint">二维码已过期，请重新获取。</div><button class="action" style="margin-top:10px" onclick="chStartWeixinQr()">重新获取二维码</button>'; }
    else if(st==='confirmed'){
      if(stEl) stEl.textContent='登录成功，正在保存凭证…';
      apiPost('/api/channels/weixin',{ credentials:{ WEIXIN_TOKEN:res.token||'', WEIXIN_ACCOUNT_ID:res.account_id||'', WEIXIN_BASE_URL:res.base_url||'' } }).then(function(){
        apiGet('/api/channels').then(function(r2){ if(typeof _chState!=="undefined") _chState.channels=(r2&&r2.channels)||_chState.channels; renderChannels(); chShowQrSuccess('微信'); });
      });
    }
  }).catch(function(e){
    // 网络波动（如网关重启窗口）：静默重试 5 次
    if(retry<5){ setTimeout(function(){ if(seq===cur()) window.chPollWeixinQr(qrcode, seq, retry+1); }, 2500); return; }
    var stEl=document.getElementById('wxQrStatus'); if(stEl) stEl.textContent='轮询出错：'+(e.message||e);
  });
};

/* QQ 机器人扫码登录（Hermes qqbot onboard：q.qq.com 二维码 + 轮询；slot=机器人编号1-5） */
window.chStartQqbotQr=function(slot){
  slot=Number(slot)||1;
  var seq=(typeof _chQrSeq!=="undefined")?++_chQrSeq:0;
  var body=document.getElementById('chModalBody');
  if(!body) return;
  body.innerHTML='<div class="conn-hint">正在获取 QQ 机器人'+(slot>1?' '+slot:'')+'登录二维码…</div>';
  apiGet('/api/channels/qqbot/qr?slot='+slot).then(function(res){
    if(seq!==(typeof _chQrSeq!=="undefined"?_chQrSeq:0)) return;
    if(!res || res.error) throw new Error(res.error||'获取二维码失败');
    var deep=res.qrcode_url||'';
    if(!deep){ body.innerHTML='<div class="conn-hint" style="color:var(--red)">二维码生成失败</div>'; return; }
    body.innerHTML='<div class="conn-hint">用 QQ「扫一扫」扫描下方二维码，在手机上确认添加机器人'+(slot>1?' '+slot:'')+'。</div><div style="display:flex;justify-content:center;padding:12px"><canvas id="qqQR" width="220" height="220" style="width:220px;height:220px;background:#fff;border-radius:var(--radius-md)"></canvas></div><div id="qqQrStatus" style="text-align:center;font-size:13px;color:var(--text3)">等待扫码…</div>';
    if(typeof chRenderQr==="function"){ try{ chRenderQr(deep, 'qqQR'); }catch(e){} }
    window.chPollQqbotQr(res.task_id, seq, slot);
  }).catch(function(e){ if(seq!==(typeof _chQrSeq!=="undefined"?_chQrSeq:0)) return; body.innerHTML='<div class="conn-hint" style="color:var(--red)">无法获取二维码：'+(e.message||e)+'</div>'; });
};
window.chPollQqbotQr=function(taskId, seq, slot, retry){
  if(seq===undefined) seq=(typeof _chQrSeq!=="undefined")?_chQrSeq:0;
  slot=Number(slot)||1;
  retry=retry||0;
  var cur=function(){ return (typeof _chQrSeq!=="undefined")?_chQrSeq:0; };
  api('/api/channels/qqbot/qr/status?task_id='+encodeURIComponent(taskId)+'&slot='+slot,'GET').then(function(res){
    if(seq!==cur()) return;
    if(!res || res.error){
      if(retry<4){ setTimeout(function(){ if(seq===cur()) window.chPollQqbotQr(taskId, seq, slot, retry+1); }, 2500); return; }
      var stEl=document.getElementById('qqQrStatus'); if(stEl) stEl.textContent='轮询出错：'+(res&&res.error||'未知错误');
      return;
    }
    var st=res.status; var stEl=document.getElementById('qqQrStatus');
    if(st==='wait'){ if(stEl) stEl.textContent='等待扫码…'; setTimeout(function(){ if(seq===cur()) window.chPollQqbotQr(taskId, seq, slot); }, 3000); }
    else if(st==='confirmed'){
      if(stEl) stEl.textContent='✅ 已绑定机器人'+(slot>1?' '+slot:'')+' App ID: '+(res.app_id||'')+'，正在保存凭证并重启网关…';
      setTimeout(function(){ if(typeof apiGet==="function") apiGet('/api/channels').then(function(r2){ if(typeof _chState!=="undefined") _chState.channels=(r2&&r2.channels)||_chState.channels; renderChannels(); }); if(typeof chShowQrSuccess==="function") chShowQrSuccess('QQ 机器人'+(slot>1?' '+slot:'')); }, 2000);
    }
    else if(st==='expired'){ var b=document.getElementById('chModalBody'); if(b) b.innerHTML='<div class="conn-hint">二维码已过期，请重新获取。</div><button class="action" style="margin-top:10px" onclick="chStartQqbotQr('+slot+')">重新获取二维码</button>'; }
  }).catch(function(e){
    if(retry<5){ setTimeout(function(){ if(seq===cur()) window.chPollQqbotQr(taskId, seq, slot, retry+1); }, 2500); return; }
    var stEl=document.getElementById('qqQrStatus'); if(stEl) stEl.textContent='轮询出错：'+(e.message||e);
  });
};

/* QQ 配置弹窗：机器人2-5 字段加「📷 扫码」按钮（分别扫码绑定） */
function qqbotSlotScanBtns(){
  var body=document.getElementById('chModalBody'); if(!body) return;
  if(body.getAttribute('data-scan-bound')) return;
  body.setAttribute('data-scan-bound','1');
  for(var s=2;s<=5;s++){
    var inp=document.getElementById('chf_QQ_APP_ID_'+s);
    if(!inp) continue;
    var f=inp.closest('.field'); if(!f) continue;
    var b=el30("button","📷 扫码","");
    b.title="扫码绑定机器人"+s+"（App ID/Secret 自动填入）";
    b.style.cssText="margin-top:4px;font-size:11px;padding:2px 10px;border:1px solid var(--accent);color:var(--accent);border-radius:6px;background:transparent;cursor:pointer;display:inline-flex;align-items:center;gap:2px";
    b.onclick=(function(slot){ return function(){ chStartQqbotQr(slot); }; })(s);
    f.appendChild(b);
  }
}
if(window.openChannelModal){
  var _ocm=window.openChannelModal;
  window.openChannelModal=function(id){
    var r=_ocm.apply(this,arguments);
    if(id==='qqbot') setTimeout(function(){ try{ qqbotSlotScanBtns(); }catch(e){} }, 200);
    return r;
  };
}

/* 历史消息渲染：逐条容错（单条渲染失败不中断，保证刷新后完整显示） */
window.renderRoomMessages=function(msgs){
  var box=document.getElementById('roomMsgs'); if(!box) return;
  box.innerHTML='';
  (msgs||[]).forEach(function(m){
    try{
      // m.from=发送者 key, m.label=显示名（如"心理专家"）
      var isUser=(m.kind==='user'||m.from==='me');
      var displayName=m.label||m.from||'成员';
      window.roomMsgAppend(isUser?'me':'member', displayName, m.text, isUser, m.from, m.ts);
    }
    catch(e){}
  });
  box.scrollTop=box.scrollHeight;
};

/* 扫码绑定成功：自动等待网关重启完成，然后自动关闭弹窗 */
window.chShowQrSuccess=function(name){
  var body=document.getElementById('chModalBody'); var foot=document.getElementById('chModalFoot');
  if(foot) foot.innerHTML='';
  if(body) body.innerHTML='<div style="text-align:center;padding:18px 8px"><div style="font-size:42px;line-height:1">✅</div><div style="font-weight:600;margin-top:8px">'+esc(name)+' 已成功关联</div><div class="conn-hint" style="margin-top:8px">凭证已写入本机，网关正在自动重启生效…</div><div id="chQrWait" style="margin-top:10px;font-size:12px;color:var(--muted)">⏳ 网关重启中…</div></div>';
  var tries=0;
  var timer=setInterval(function(){
    tries++;
    apiGet('/api/status').then(function(r){
      var gw=(r&&r.gateway!==undefined)?r.gateway:null;
      var ok=gw===true||gw==='running'||gw==='healthy'||gw==='ok'||(r&&r.ok===true)||(r&&gw&&typeof gw==='object');
      var st=document.getElementById('chQrWait');
      if(ok||tries>=15){
        clearInterval(timer);
        if(st) st.textContent='✅ 网关已就绪';
        setTimeout(function(){ if(typeof closeChannelModal==="function") closeChannelModal(); if(typeof renderChannels==="function") renderChannels(); }, 700);
      }else if(st){
        st.textContent='⏳ 网关重启中…（已等待 '+(tries*2)+'s）';
      }
    }).catch(function(){
      // 网络错误（网关重启窗口）：同样推进计时，超时自动关闭
      var st=document.getElementById('chQrWait');
      if(tries>=15){
        clearInterval(timer);
        setTimeout(function(){ if(typeof closeChannelModal==="function") closeChannelModal(); if(typeof renderChannels==="function") renderChannels(); }, 700);
      }else if(st){
        st.textContent='⏳ 网关重启中…（已等待 '+(tries*2)+'s）';
      }
    });
  },2000);
};

/* 各通道「连接使用指南」链接（Hermes 官方文档 + QQ 龙虾机器人文档 + QClaw 等） */
var CHANNEL_GUIDES={
  qqbot:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/qqbot",t:"Hermes QQBot 官方文档"},{u:"https://docs.qq.com/doc/DTFRyQURhT2ZvQ25J",t:"QQ 机器人使用文档（扫码添加）"},{u:"https://qclaw.qq.com/docs/206087648449069056",t:"QClaw 接入指南"}],
  weixin:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/weixin",t:"Hermes 微信官方文档"},{u:"https://qclaw.qq.com/docs/206087648449069056",t:"微信接入指南（扫码）"}],
  wecom:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/wecom",t:"Hermes 企业微信官方文档"},{u:"https://qclaw.qq.com/docs/206087648449069056",t:"企业微信接入指南"}],
  feishu:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/feishu",t:"Hermes 飞书官方文档"},{u:"https://open.feishu.cn/document/",t:"飞书开放平台文档"}],
  dingtalk:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/dingtalk",t:"Hermes 钉钉官方文档"},{u:"https://open.dingtalk.com/document/",t:"钉钉开放平台文档"}],
  telegram:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/telegram",t:"Hermes Telegram 官方文档"},{u:"https://core.telegram.org/bots",t:"Telegram Bot 官方文档"}],
  discord:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/discord",t:"Hermes Discord 官方文档"},{u:"https://discord.com/developers/docs/intro",t:"Discord 开发者文档"}],
  slack:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/slack",t:"Hermes Slack 官方文档"},{u:"https://api.slack.com/start/building/bolt-python",t:"Slack 开发文档"}],
  whatsapp:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/whatsapp",t:"Hermes WhatsApp 官方文档"},{u:"https://docs.360img.com/",t:"WhatsApp Cloud API 文档"}],
  matrix:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/matrix",t:"Hermes Matrix 官方文档"},{u:"https://matrix.org/docs/guides/",t:"Matrix 官方文档"}],
  signal:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/signal",t:"Hermes Signal 官方文档"}],
  google_chat:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/google_chat",t:"Hermes Google Chat 官方文档"}],
  sms:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/sms",t:"Hermes SMS 官方文档"}],
  email:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/email",t:"Hermes Email 官方文档"}],
  mattermost:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/mattermost",t:"Hermes Mattermost 官方文档"}],
  wechatmp:[{u:"https://developers.weixin.qq.com/doc/",t:"微信公众平台开发文档"}],
  yuanbao:[{u:"https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/messaging/yuanbao",t:"Hermes 元宝官方文档"}]
};
window.renderChannels=function(){
  var el=document.getElementById('channelGrid'); if(!el) return;
  if(typeof apiGet!=="function") return;
  apiGet('/api/channels').then(function(res){
    if(!res || res.error){ el.innerHTML='<div class="empty-state" style="color:var(--red)">加载频道失败：'+(res&&res.error||'未知')+'</div>'; return; }
    if(typeof _chState!=="undefined"){ _chState.defs = res.defs || {}; _chState.channels = res.channels || {}; }
    var defs=(typeof _chState!=="undefined")?_chState.defs:{}, ch=(typeof _chState!=="undefined")?_chState.channels:{};
    var ids=Object.keys(defs);
    if(typeof _chFilter!=="undefined"){
      if(_chFilter==='configured') ids=ids.filter(function(id){ return !!((ch[id]||{}).configured); });
      else if(_chFilter==='unconfigured') ids=ids.filter(function(id){ return !((ch[id]||{}).configured); });
    }
    ids.sort(function(a,b){ return ((ch[b]||{}).configured?1:0) - ((ch[a]||{}).configured?1:0); });
    el.innerHTML = ids.map(function(id){
      var def=defs[id]; var c=ch[id]||{}; var configured=!!c.configured;
      var badge=configured?'<span class="badge on">已配置</span>':'<span class="badge off">未配置</span>';
      var toggleHtml = configured
        ? '<div class="toggle-row" style="margin-top:8px"><label class="toggle '+(c.enabled!==false?'on':'')+'" onclick="event.stopPropagation();chChannelToggle(\''+id+'\')" title="启用/禁用该渠道"><span class="toggle-switch"></span></label><span class="toggle-lbl" style="font-size:12px">'+(c.enabled!==false?'已启用':'已禁用')+'</span></div>'
        : '';
      var action=def.qrLogin?'<button class="action" onclick="event.stopPropagation();openChannelModal(\''+id+'\')">扫码登录</button>':'<button class="action" onclick="event.stopPropagation();openChannelModal(\''+id+'\')">配置</button>';
      // 使用指南链接
      var guides=CHANNEL_GUIDES[id]||[];
      var guideHtml=guides.length?('<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+guides.map(function(g){
        return '<a class="action" href="'+g.u+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:11px;padding:2px 10px;text-decoration:none;color:var(--accent);border:1px solid var(--accent);border-radius:6px;display:inline-flex;align-items:center;gap:3px">📖 '+esc(g.t)+'</a>';
      }).join('')+'</div>'):'';
      var svgIcon = (window.PV && PV.ICONS && PV.ICONS[id]) ? PV.ICONS[id] : null;
      var iconHtml = svgIcon ? '<div class="icon svg-icon">'+svgIcon+'</div>' : '<div class="icon">'+(def.icon||'🔌')+'</div>';
      return '<div class="connector-card" onclick="openChannelModal(\''+id+'\')">'+
        '<div class="top">'+iconHtml+'<div><div class="name">'+esc(def.name)+' '+badge+'</div><div class="status">'+(def.note||'配置后可在该平台收发消息')+'</div></div></div>'+
        toggleHtml+action+guideHtml+'</div>';
    }).join('') || '<div class="empty-state">该筛选下暂无频道。</div>';
  }).catch(function(){ if(typeof toast==="function") toast('加载频道失败'); });
};

/* 会话面板护栏：非对话页硬性隐藏对话会话树（display:none 覆盖一切 class 冲突）；
   移动端（<=768px）对话页也强制收起会话树（抽屉模式，用户点「打开会话树」才显示） */
function railGuard(){
  try{
    var rail=document.getElementById('chatRail'); if(!rail) return;
    var cur=((location.hash||'').replace(/^#\/?/,''))||'chat';
    var ov=document.getElementById('chatRailOverlay');
    var mobile=(window.matchMedia&&window.matchMedia('(max-width:768px)').matches)||window.innerWidth<=768;
    if(cur!=='chat'){
      // 群聊/其他页：彻底隐藏（含 open 状态）
      rail.style.display='none';
      rail.classList.remove('open'); rail.classList.add('hidden');
      if(ov){ ov.style.display='none'; ov.classList.remove('open'); }
    } else {
      // 对话页：恢复显示（由原 CSS 控制 hidden/open）
      rail.style.display='';
      if(ov) ov.style.display='';
      if(mobile){
        // 移动端：强制收起会话树（不残留 open/hidden 展开状态）
        rail.classList.remove('open');
        if(ov) ov.classList.remove('open');
      }
    }
  }catch(e){}
}

/* 群聊左侧房间列表折叠：复用标题旁全局折叠按钮（sidebarToggle/toggleRail） */
function roomsSideFold(){
  var layout=document.querySelector('.rooms-layout'); if(!layout) return;
  var side=layout.querySelector('.rooms-side'); if(!side) return;
  if(layout.getAttribute('data-fold-bound')) return;
  layout.setAttribute('data-fold-bound','1');
  if(!document.getElementById('roomsFoldStyle')){
    var st=document.createElement('style'); st.id='roomsFoldStyle';
    st.textContent='.rooms-side{transition:width .18s ease,opacity .18s ease}.rooms-side.collapsed{width:0;overflow:hidden;border-right:none;opacity:0}';
    document.head.appendChild(st);
  }
  // 劫持标题旁全局折叠按钮：群聊页 → 折叠房间列表；其他页 → 原逻辑
  if(window.toggleRail && !window.__railHooked){
    window.__railHooked=true;
    var _tr=window.toggleRail;
    window.toggleRail=function(){
      var cur=((location.hash||'').replace(/^#\/?/,''))||'chat';
      if(cur==='rooms'||cur==='room'){
        try{
          var sd=document.querySelector('.rooms-layout .rooms-side');
          if(sd){
            var folded=sd.classList.toggle('collapsed');
            var btn=document.getElementById('sidebarToggle');
            if(btn) btn.title=folded?'展开房间列表':'折叠房间列表';
            return;
          }
        }catch(e){}
      }
      return _tr();
    };
  }
}
window.roomsSideToggle=function(){
  try{
    var side=document.querySelector('.rooms-layout .rooms-side');
    if(!side) return;
    side.classList.toggle('collapsed');
  }catch(e){}
};
/* v0.21.147：移动端群聊房间列表展开/收起（浮层；CSS 默认隐藏，按钮切换 m-open），
   展开时移除旧 collapsed 避免 width:0 冲突 */
window.toggleRoomListMobile=function(){
  try{
    var side=document.querySelector('.rooms-layout .rooms-side');
    if(!side) return;
    var open=side.classList.toggle('m-open');
    side.classList.remove('collapsed');
    var btn=document.getElementById('roomListToggle');
    if(btn) btn.textContent=open?'✕ 收起':'☰ 房间';
  }catch(e){}
};

/* 主对话回复发送者名：绑定专家时显示专家名（去掉 emoji 前缀），否则 Hermes */
window.chatSenderName=function(){
  try{
    if(window._selectedExpert&&_selectedExpert.name){
      var n=String(_selectedExpert.name||'').split(' ').pop();
      if(n) return n;
    }
  }catch(e){}
  return 'Hermes';
};

/* @ 专家一次性语义：新消息发送后自动清除专家绑定（下一条恢复默认角色） */
function chatAtOnceClear(){
  if(window.__atOnceHooked) return;
  window.__atOnceHooked=true;
  try{
    var _os=window.onSendOrStop;
    if(typeof _os!=="function") return;
    window.onSendOrStop=function(){
      var r=_os.apply(this,arguments);
      try{
        // 仅新消息发送时清除（流式中的纠偏/停止不清除）
        if(!(window._msgState&&_msgState.streaming)){
          if(typeof _personaPrompt!=="undefined") _personaPrompt='';
          if(typeof _selectedExpert!=="undefined"){ _selectedExpert=null; if(typeof renderSelectedExpertBar==="function") renderSelectedExpertBar(); }
        }
      }catch(e){}
      return r;
    };
  }catch(e){}
}

/* AI 自主接力（DGA）：群聊工具栏按钮 + 状态 */
function roomAutoPilotBind(){
  var tb=document.getElementById('roomToolbar'); if(!tb) return;
  if(document.getElementById('roomAutoBtn')) return;
  // 纯图标按钮（对齐工具栏其他 tool-btn）：机器人图标
  var btn=el30("button",'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1.5"/><circle cx="15" cy="13" r="1.5"/></svg>',"tool-btn");
  btn.id="roomAutoBtn"; btn.title="AI 自主接力：默认自动开启——你发消息后 AI 主持人自动选专家接续发言，无需手动 @；点击可调轮数/停止";
  btn.onclick=function(){
    var room=(typeof roomsStore!=="undefined"&&roomsStore)?roomsStore.find(function(x){ return String(x.id)===String(currentRoom); }):null;
    var ap=(room&&room.autopilot)||{};
    var cur=(ap.limit||8);
    var ov=modal30("🤖 AI 自主接力（AI 进化论）",
      '<div style="font-size:12.5px;color:var(--text2);line-height:1.6;margin-bottom:10px"><b>现在默认自动</b>：你在群里发任何消息都会自动触发——AI 主持人现场从成员里选<b>最合适</b>的下一位接续发言（提问/补充/质疑/总结），一轮接一轮推进，直到主持人判定讨论完成，全程无需手动 @、无需开按钮。这里可调整每轮上限或手动停止。</div>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:12.5px;font-weight:600;color:var(--text);flex-shrink:0">接力轮数</span>'+
      '<input id="roomAutoLimit" type="number" min="1" max="12" value="'+cur+'" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);font-size:12.5px">'+
      '<span style="font-size:11px;color:var(--muted);flex-shrink:0">默认 8 · 最大 12（防 Token 消耗）</span></div>'+
      (ap.active?'<div style="font-size:12px;color:var(--accent);background:var(--accent-bg);padding:6px 10px;border-radius:8px">当前接力进行中，剩余 '+ap.remaining+' 轮</div>':''),
      '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>'+
      '<button class="btn primary" onclick="roomAutoPilotSet(false)">停止接力</button>'+
      '<button class="btn primary" onclick="roomAutoPilotSet(true)">开始接力</button>');
    var inp=ov?ov.querySelector('#roomAutoLimit'):null;
    if(inp){ inp.addEventListener('keydown',function(e){ if(e.key==='Enter') roomAutoPilotSet(true); }); }
  };
  tb.appendChild(btn);
}
window.roomAutoPilotSet=function(active){
  var inp=document.getElementById('roomAutoLimit');
  var limit=inp?parseInt(inp.value,10):8;
  if(!limit||limit<1) limit=8;
  if(limit>12) limit=12;
  api30('/api/rooms/'+encodeURIComponent(currentRoom)+'/autopilot','POST',{active:!!active,limit:limit}).then(function(r){
    if(r&&r.ok){
      toast30(active?('🤖 AI 接力已开启（'+limit+' 轮，AI 自主选角）'):'接力已停止','success');
      // 同步房间状态
      if(typeof roomsStore!=="undefined"&&roomsStore){
        var room=roomsStore.find(function(x){ return String(x.id)===String(currentRoom); });
        if(room) room.autopilot=r.autopilot;
      }
      var ov=document.querySelector('.modal-overlay'); if(ov) ov.remove();
    } else toast30('操作失败: '+((r&&r.error)||''),'error');
  }).catch(function(e){ toast30('操作失败: '+e.message,'error'); });
};

/* 群聊输入框 @ 触发房间成员浮层（对齐主对话 @ 专家交互） */
function roomComposeAtBind(){
  var ta=document.getElementById('roomCompose');
  if(!ta||ta.getAttribute('data-at-bound2')) return;
  ta.setAttribute('data-at-bound2','1');
  var panel=null;
  function renderPanel(kw){
    if(!panel){
      // 与主对话 @ 浮层同款：搜索框 + 紧凑列表 + 小气泡样式
      panel=el30("div",'<div style="padding:4px 6px;border-bottom:1px solid var(--border)"><input id="roomAtSearch" type="text" placeholder="🔍 搜索成员…" style="width:100%;padding:3px 8px;font-size:11.5px;border:1px solid var(--border);border-radius:8px;background:var(--bg1);color:var(--text);outline:none"></div><div id="roomAtList" style="max-height:220px;overflow-y:auto;padding:2px"></div>');
      panel.style.cssText="position:absolute;bottom:100%;left:14px;width:288px;max-width:80vw;z-index:600;background:var(--bg2);border:1px solid var(--border);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.16);display:none;overflow:hidden";
      var wrap=ta.closest('.input-outer')||ta.parentNode;
      if(wrap) wrap.style.position='relative';
      if(wrap) wrap.appendChild(panel);
      var si=panel.querySelector('#roomAtSearch');
      if(si){
        si.addEventListener('input',function(){ renderPanelList(this.value); });
        si.addEventListener('keydown',function(e){
          if(e.key==='Enter'){ e.preventDefault(); var first=panel.querySelector('#roomAtList [data-at]'); if(first) first.click(); }
          if(e.key==='Escape'){ panel.style.display='none'; }
        });
      }
    }
    var si2=panel.querySelector('#roomAtSearch');
    if(si2) si2.value='';
    renderPanelList(kw);
    panel.style.display='block';
    if(si2) setTimeout(function(){ si2.focus(); },30);
  }
  function renderPanelList(kw){
    var room=(typeof roomsStore!=="undefined"&&roomsStore)?roomsStore.find(function(x){ return String(x.id)===String(currentRoom); }):null;
    var ms=(room&&room.members)||[];
    var kw2=(kw||"").toLowerCase();
    var fl=ms.filter(function(m){ return !kw2||(m.label||"").toLowerCase().indexOf(kw2)>=0; });
    var listEl=panel?panel.querySelector('#roomAtList'):null;
    if(!listEl) return;
    var list=el30("div",'');
    if(!fl.length){ list.innerHTML='<div style="padding:8px;font-size:12px;color:var(--muted)">该房间暂无匹配成员（可点「@ 成员」按钮或建房时勾选专家）</div>'; }
    else fl.forEach(function(m){
      var it=el30("div",'<span style="font-size:13px;flex-shrink:0">'+(m.emoji||"🧠")+'</span><span style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc30(m.label)+'</span><span style="margin-left:auto;flex-shrink:0;font-size:10px;color:var(--accent);background:var(--accent-bg);padding:0 6px;border-radius:7px">成员</span>');
      it.setAttribute('data-at','1');
      it.style.cssText="display:flex;gap:6px;align-items:center;padding:4px 8px;cursor:pointer;font-size:11.5px;border-radius:7px";
      it.onmouseenter=function(){ it.style.background="var(--accent-bg)"; };
      it.onmouseleave=function(){ it.style.background=""; };
      it.onclick=function(){
        if(typeof roomAt!=="undefined") roomAt.add(m.key);
        if(typeof roomRenderAtBar==="function") roomRenderAtBar();
        if(panel) panel.style.display="none";
        ta.value=(ta.value||"").replace(/@[^\s@]*$/,"");
        toast30("已 @ "+(m.label||""),"success");
        ta.focus();
      };
      list.appendChild(it);
    });
    listEl.innerHTML=""; listEl.appendChild(list);
    listEl.scrollTop=0;
  }
  ta.addEventListener("input",function(){
    var m=(ta.value||"").match(/@([^\s@]*)$/);
    if(m){ renderPanel(m[1]); } else if(panel){ panel.style.display="none"; }
  });
  ta.addEventListener("keydown",function(e){ if(e.key==="Escape"&&panel) panel.style.display="none"; });
  document.addEventListener("click",function(e){ if(panel&&!panel.contains(e.target)&&e.target!==ta) panel.style.display="none"; });
}
function roomUploadInsert(f){
  var ta=document.getElementById('roomCompose'); if(!ta) return;
  var isImg=/^image\//.test(f.type||'');
  var fd=new FormData(); fd.append('file',f); fd.append('profile',(window.currentAgent||'default'));
  var hdrs={}; if(window.monitorToken) hdrs['X-Monitor-Token']=window.monitorToken;
  var apiFn=window.apiUrl||function(p){return p;};
  fetch(apiFn(isImg?'/api/chat/upload-image':'/api/chat/upload-file'),{method:'POST',body:fd,headers:hdrs})
    .then(function(r){ return r.json(); })
    .then(function(out){
      if(out&&!out.error&&out.url){
        ta.value=(ta.value?ta.value+' ':'')+(isImg?('![图片]('+out.url+')'):('['+f.name+']('+out.url+')'));
        toast30((isImg?'图片':'附件')+'已添加','success');
      } else toast30('上传失败: '+((out&&out.error)||''),'error');
    })
    .catch(function(){ toast30('上传失败，无法连接后端','error'); });
}

/* ═══ 14. 群聊消息渲染：复用主对话 renderMarkdown（格式完全一致） ═══ */
function renderRoomMd(text){
  var t=String(text||"");
  // 清理 Hermes 附件对象被字符串化的 [object Object] 噪音
  t=t.replace(/\[object Object\]/g,"").replace(/\n{3,}/g,"\n\n").trim();
  if(!t) return "";
  // 与主对话同一渲染管线（marked.parseSync + 预处理 + 表格/引用/base 补全）
  if(typeof window.renderMarkdown==="function"){ try{ return window.renderMarkdown(t,false); }catch(e){} }
  try{
    if(window.marked&&window.DOMPurify){
      var m=window.marked.parseSync||window.marked.parse;
      var html=(typeof m==="function")?m(t,{breaks:true,gfm:true,async:false}):t;
      return DOMPurify.sanitize(html,{ADD_ATTR:["target"]});
    }
  }catch(e){}
  return escapeHtml(t).replace(/\n/g,"<br>");
}
// 群聊消息块样式：对齐主对话 .msg/.msg-bubble 布局 + 发送者置顶（头像+大号名字）
function roomMdStyle(){
  if(document.getElementById('roomMdStyle')) return;
  var st=document.createElement('style'); st.id='roomMdStyle';
  st.textContent='.chat-sender{font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px}.msg.user .chat-sender{align-self:flex-end;color:var(--accent)}'+
  '.rooms-msgs{display:flex;flex-direction:column;gap:16px}.rooms-msgs .msg{max-width:85%}.rooms-msgs .msg .room-sender{display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px}.rooms-msgs .msg .room-sender .rs-av{display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--bg3);align-items:center;justify-content:center;font-size:13px;flex-shrink:0;border:1px solid var(--border)}.rooms-msgs .msg .room-sender .sn{font-weight:700;color:var(--text);font-size:13px}.rooms-msgs .msg .room-sender .rs-t{color:var(--muted);font-size:11px;font-weight:400}.rooms-msgs .msg.user{align-self:flex-end;align-items:flex-end}.rooms-msgs .msg.assistant{align-self:flex-start;align-items:flex-start}.rooms-msgs .msg.user .msg-bubble{background:var(--accent);color:#fff;border-bottom-right-radius:4px}.rooms-msgs .msg.assistant .msg-bubble{background:var(--bg1);border:1px solid var(--border);border-bottom-left-radius:4px;color:var(--text)}.rooms-msgs .msg .msg-bubble img{max-width:100%;border-radius:8px}.rooms-msgs .tool-line{font-size:11px;color:var(--muted);background:var(--bg3);border-radius:6px;padding:3px 8px;margin:4px 0;display:inline-block;font-family:var(--font)}.rooms-msgs .thinking{font-size:11.5px;color:var(--muted);border-left:3px solid var(--warning);padding:4px 10px;margin:6px 0;background:var(--bg2);border-radius:4px;white-space:pre-wrap;display:none}.rooms-msgs .thinking.open{display:block}.rooms-msgs .thinking .rt-ttl{cursor:pointer}';
  document.head.appendChild(st);
}
function roomTime30(){ var d=new Date(); return ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2); }
function roomTimeFrom(ts){
  if(!ts) return roomTime30();
  var d=new Date(ts);
  return ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);
}
function roomMemberEmoji(key){
  try{
    if(typeof roomsStore!=="undefined"&&roomsStore){
      var room=roomsStore.find(function(x){ return String(x.id)===String(currentRoom); });
      var m=(room&&room.members||[]).find(function(x){ return x.key===key; });
      if(m&&m.emoji) return m.emoji;
    }
  }catch(e){}
  return "";
}
window.roomMsgAppend=function(kind,label,text,isMe,key,ts){
  try{
    var box=document.getElementById('roomMsgs'); if(!box) return;
    var empty=box.querySelector('.rooms-empty'); if(empty) empty.remove();
    var el=document.createElement('div');
    el.className='msg '+(isMe?'user':'assistant');
    var sender=document.createElement('div'); sender.className='room-sender';
    if(!isMe){
      var em=roomMemberEmoji(key);
      if(em) sender.innerHTML='<span class="rs-av">'+esc30(em)+'</span>';
    }
    sender.innerHTML+='<span class="sn">'+escapeHtml(isMe?'你':(label||'成员'))+'</span><span class="rs-t">'+((typeof ts==='number')?roomTimeFrom(ts):roomTime30())+'</span>';
    var bubble=document.createElement('div'); bubble.className='msg-bubble';
    bubble.innerHTML=renderRoomMd(text);
    el.appendChild(sender); el.appendChild(bubble);
    // 历史消息操作按钮：复制/刷新（仅成员回复）
    if(!isMe&&key){
      var hts=(typeof ts==='number')?ts:(typeof key==='number'?key:Date.now());
      var acts=roomMsgActions(el,function(){ return String(text||''); },function(){ return hts; },function(){ return key; });
      el.appendChild(acts);
    }
    box.appendChild(el); box.scrollTop=box.scrollHeight;
  }catch(e){}
  return el;
};
/* 群聊消息操作按钮：复制（保留格式）/ 刷新（重新生成） */
function roomMsgActions(el, textGetter, tsGetter, keyGetter){
  var acts=document.createElement('div');
  acts.className='msg-actions';
  acts.style.cssText="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap";
  var mk=function(txt,fn){
    var b=document.createElement('button');
    b.className='msg-act-btn';
    b.textContent=txt;
    b.onclick=fn;
    acts.appendChild(b);
    return b;
  };
  mk('📋 复制',function(){
    var t=textGetter?textGetter():'';
    if(!t){ toast30('内容为空','error'); return; }
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(function(){ toast30('已复制（保留格式）','success'); }); }
      else { var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast30('已复制（保留格式）','success'); }
    }catch(e){ toast30('复制失败','error'); }
  });
  mk('🔄 刷新',function(){
    var ts=tsGetter?tsGetter():0;
    if(!ts){ toast30('无法定位消息','error'); return; }
    var root=el.closest('.msg')||el; if(root&&root.parentNode) root.remove();
    api30('/api/rooms/'+encodeURIComponent(currentRoom)+'/regenerate','POST',{ts:ts}).then(function(r){
      if(!r||r.ok===false) toast30('重新生成失败: '+((r&&r.error)||''),'error');
    }).catch(function(e){ toast30('重新生成失败: '+e.message,'error'); });
  });
  return acts;
}
window.roomStreamEl=function(label,key){
  var box=document.getElementById('roomMsgs'); if(!box) return null;
  var empty=box.querySelector('.rooms-empty'); if(empty) empty.remove();
  var el=document.createElement('div');
  el.className='msg assistant';
  var sender=document.createElement('div'); sender.className='room-sender';
  var em=roomMemberEmoji(key);
  if(em) sender.innerHTML='<span class="rs-av">'+esc30(em)+'</span>';
  sender.innerHTML+='<span class="sn">'+escapeHtml(label||'成员')+'</span><span class="rs-t">'+roomTime30()+'</span>';
  var bubble=document.createElement('div'); bubble.className='msg-bubble';
  var md=document.createElement('div'); md.className='md-text'; md.innerHTML='<span class="cursor-blink">|</span>';
  bubble.appendChild(md);
  el.appendChild(sender); el.appendChild(bubble);
  // 操作按钮：复制（保留格式）/ 刷新（重新生成）
  var _store={text:'',ts:Date.now(),key:key||''};
  var acts=roomMsgActions(el,function(){ return _store.text; },function(){ return _store.ts; },function(){ return _store.key; });
  el.appendChild(acts);
  box.appendChild(el); box.scrollTop=box.scrollHeight;
  el.__roomStore=_store;
  return el;
};
window.connectRoomStream=function(id){
  if(typeof roomEventSrc!=="undefined"&&roomEventSrc){ try{ roomEventSrc.close(); }catch(e){} window.roomEventSrc=null; }
  if(typeof roomLive!=="undefined") roomLive={};
  var es=new EventSource(apiUrl('/api/rooms/'+encodeURIComponent(id)+'/events'));
  if(typeof roomEventSrc!=="undefined") window.roomEventSrc=es;
  es.onmessage=function(ev){
    var p; try{ p=JSON.parse(ev.data); }catch(e){ return; }
    var live=(typeof roomLive!=="undefined")?roomLive:{};
    if(p.type==='user'){ window.roomMsgAppend('me','我',p.text,true); }
    else if(p.type==='start'){
      live[p.key]={ el:typeof window.roomStreamEl==="function"?window.roomStreamEl(p.label,p.key):null, text:'', reason:'' };
    }else if(p.type==='delta'){
      var l=live[p.key]; if(!l||!l.el) return;
      l.text+=p.delta;
      var tx=l.el.querySelector('.md-text'); if(tx) tx.innerHTML=renderRoomMd(l.text); // 流式即 Markdown 渲染（保留格式）
      if(l.el.__roomStore) l.el.__roomStore.text=l.text;
      var box=document.getElementById('roomMsgs'); if(box) box.scrollTop=box.scrollHeight;
    }else if(p.type==='reasoning'){
      var l2=live[p.key]; if(!l2||!l2.el) return;
      l2.reason+=p.reasoning;
      var th=l2.el.querySelector('.thinking');
      if(!th){
        var d=document.createElement('div'); d.className='thinking';
        d.innerHTML='<span class="rt-ttl" onclick="this.parentElement.classList.toggle(\'open\')">🧠 思考过程</span><div style="display:none"></div>';
        var md0=l2.el.querySelector('.md-text'); if(md0) md0.before(d);
      }
      var rcd=l2.el.querySelector('.thinking div'); if(rcd) rcd.textContent=l2.reason;
    }else if(p.type==='tool'){
      var l3=live[p.key]; if(!l3||!l3.el) return;
      var tl=document.createElement('div'); tl.className='tool-line';
      var tname=(typeof p.tool==='string')?p.tool:((p.tool&&(p.tool.name||p.tool.label||p.tool.command||p.tool.tool||p.tool.summary))||'');
      tl.textContent='🛠 '+String(tname||'').replace(/\[object Object\]/g,'');
      var md1=l3.el.querySelector('.md-text'); if(md1) md1.after(tl); else l3.el.querySelector('.msg-bubble').appendChild(tl);
    }else if(p.type==='done'){
      var l4=live[p.key];
      if(l4&&l4.el){
        var md2=l4.el.querySelector('.md-text');
        if(md2) md2.innerHTML=renderRoomMd(p.text||l4.text||'');
        if(l4.el.__roomStore){ l4.el.__roomStore.text=(p.text||l4.text||''); if(p.ts) l4.el.__roomStore.ts=p.ts; }
      }
      delete live[p.key];
    }else if(p.type==='autopilot'){
      // AI 接力状态：显示/更新状态条
      var bar=document.getElementById('roomAutoStatus');
      if(!bar){
        var atbar=document.getElementById('roomAtBar');
        bar=el30("div",'');
        bar.id="roomAutoStatus";
        bar.style.cssText="font-size:11.5px;padding:4px 10px;border-radius:8px;margin-bottom:6px;background:var(--accent-bg);color:var(--accent)";
        if(atbar&&atbar.parentNode) atbar.parentNode.insertBefore(bar, atbar.nextSibling);
      }
      if(p.active){
        bar.style.display='';
        if(p.stage==='thinking'){
          bar.textContent='🤖 主持人思考中…（分析上文，现场选择下一位）';
        } else {
          bar.textContent='🤖 AI 自主接力中 · 剩余 '+p.remaining+' 轮'+(p.next?(' · 下一位：'+p.next):'')+(p.reason?('（'+p.reason+'）'):'');
        }
      } else {
        bar.textContent='✅ AI 接力完成';
        setTimeout(function(){ bar.style.display='none'; }, 4000);
      }
    }else if(p.type==='err'){
      if(p.key==='autopilot'){
        var ebar=document.getElementById('roomAutoStatus');
        if(ebar){ ebar.textContent='⚠️ AI 接力：'+(p.error||'发生错误'); }
        else toast30('AI 接力错误: '+(p.error||''),'error');
        return;
      }
      var l5=live[p.key]; if(l5&&l5.el){ var md3=l5.el.querySelector('.md-text'); if(md3) md3.textContent='⚠️ '+p.error; }
    }
  };
  es.onerror=function(){ /* EventSource 自动重连 */ };
};

/* ═══ 11. 挂载与启动 ═══ */
function boot(){
  uiMerge();
  kbFusionMount();
  commFusionMount();
  memoryFusionMount();
  modelsFusionMount();
  settingsFusionMount();
  expertsFusionMount();
  addRoomMemBtn();
  chatInputAtBind();
  roomComposeBind();
  roomComposeAtBind();
  roomMdStyle();
  railGuard(); // 仅在启动时执行一次（防止 applyRailState 误显示会话树；不周期强制，避免覆盖用户手动展开）
  roomsSideFold();
  roomAutoPilotBind();
  chatAtOnceClear();
  // 每 5 秒补挂载（页面可能后渲染）
  setInterval(function(){
    kbFusionMount(); commFusionMount(); memoryFusionMount(); modelsFusionMount(); settingsFusionMount(); expertsFusionMount(); addRoomMemBtn();
    chatInputAtBind(); roomComposeBind(); roomComposeAtBind(); roomMdStyle(); roomsSideFold(); roomAutoPilotBind();
    modelSmokeFill();
  },5000);
  // switchPage 钩子：渲染合并页/填充模型测试下拉/会话树护栏（每次切页执行）
  if(window.switchPage){
    var _s=window.switchPage;
    window.switchPage=function(name){
      var r=_s(name);
      railGuard(); // 群聊等非对话页硬性隐藏对话会话树；对话页显示
      if(name==='models') setTimeout(modelSmokeFill,300);
      if(name==='comm') setTimeout(function(){ try{ if(typeof renderConnectors==='function') renderConnectors(); }catch(e){} },100);
      if(name==='kb') setTimeout(function(){ kbTabSwitch('tree'); },100);
      // v0.21.147：移动端房间列表默认隐藏由 CSS 兜底（任何进入方式生效），无需 JS 折叠；
      // 切走群聊页时收起浮层，避免残留遮挡
      if((name==='rooms'||name==='room')===false){
        setTimeout(function(){
          try{
            var sd=document.querySelector('.rooms-layout .rooms-side');
            if(sd&&sd.classList.contains('m-open')){ sd.classList.remove('m-open'); var b=document.getElementById('roomListToggle'); if(b) b.textContent='☰ 房间'; }
          }catch(e){}
        },60);
      }
      return r;
    };
  }
  // hash 变化也触发护栏（防刷新/手动改 hash 后会话树残留）
  window.addEventListener('hashchange', function(){ railGuard(); });
  // 暴露全局
  window.renderFlowsPage=renderFlowsPage;
  window.flowCreateDialog=flowCreateDialog; window.flowCreateConfirm=flowCreateConfirm;
  window.flowDetail=flowDetail; window.flowRun=flowRun; window.flowDelete=flowDelete;
  window.roomMemoryDialog=roomMemoryDialog; window.roomMemoryAdd=roomMemoryAdd; window.roomAttachClick=roomAttachClick;
  window.kbTabSwitch=kbTabSwitch; window.kbGraphLoad=kbGraphLoad; window.kbTraceLoad=kbTraceLoad;
  window.memDistill=memDistill; window.memLoadDaily=memLoadDaily; window.memLoadEvolution=memLoadEvolution;
  window.modelSmokeRun=modelSmokeRun; window.guardrailSave=guardrailSave;
  window.mbtiTestDialog=mbtiTestDialog; window.mbtiAnswer=mbtiAnswer; window.mbtiApplyResult=mbtiApplyResult;
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot);
else boot();
})();
