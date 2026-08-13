import fs from "fs";
const p = "index.html";
let s = fs.readFileSync(p, "utf8");
let c = 0;
// 历史 user（7192）：msg user 后加 chat-sender 你
const o1 = `    return '<div class="msg user"><div class="msg-bubble">'+escapeHtml(text).replace(/\n/g,'<br>')+imgHtml+'</div><div class="msg-meta">你 · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`;
const n1 = `    return '<div class="msg user"><div class="chat-sender">你</div><div class="msg-bubble">'+escapeHtml(text).replace(/\n/g,'<br>')+imgHtml+'</div><div class="msg-meta">你 · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`;
if (s.includes(o1)) { s = s.replace(o1, n1, 1); c++; }
else console.log("M1");
// 历史 assistant（7201）
const o2 = `  return '<div class="msg assistant" data-content="'+esc(text).replace(/"/g,'&quot;').replace(/\n/g,'&#10;')+'"><div class="msg-bubble">'+renderMarkdown(text)+imgHtml+toolsHtml+'</div>'+actionsHtml+'<div class="msg-meta">Hermes · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`;
const n2 = `  return '<div class="msg assistant" data-content="'+esc(text).replace(/"/g,'&quot;').replace(/\n/g,'&#10;')+'"><div class="chat-sender">'+chatSenderName()+'</div><div class="msg-bubble">'+renderMarkdown(text)+imgHtml+toolsHtml+'</div>'+actionsHtml+'<div class="msg-meta">'+chatSenderName()+' · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`;
if (s.includes(o2)) { s = s.replace(o2, n2, 1); c++; }
else console.log("M2");
// 发送 user（8329）
const o3 = `  userDiv.innerHTML='<div class="msg-bubble">'+escapeHtml(userText).replace(/\n/g,'<br>')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`;
const n3 = `  userDiv.innerHTML='<div class="chat-sender">你</div><div class="msg-bubble">'+escapeHtml(userText).replace(/\n/g,'<br>')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`;
if (s.includes(o3)) { s = s.replace(o3, n3, 1); c++; }
else console.log("M3");
// 发送 user（8969）
const o4 = `  userDiv.innerHTML = '<div class="msg-bubble">'+quoteHtml+redirectTag+escapeHtml(text).replace(/\n/g,'<br>')+(chips?'<div style="margin-top:6px">'+chips+'</div>':'')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`;
const n4 = `  userDiv.innerHTML = '<div class="chat-sender">你</div><div class="msg-bubble">'+quoteHtml+redirectTag+escapeHtml(text).replace(/\n/g,'<br>')+(chips?'<div style="margin-top:6px">'+chips+'</div>':'')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`;
if (s.includes(o4)) { s = s.replace(o4, n4, 1); c++; }
else console.log("M4");
fs.writeFileSync(p, s);
console.log("total", c);
