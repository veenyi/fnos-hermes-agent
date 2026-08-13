import fs from "fs";
const p = "index.html";
let s = fs.readFileSync(p, "utf8");
let c = 0;
const reps = [
  // 1) 历史 user 消息：顶部加"你"（加粗）
  [`return '<div class="msg user"><div class="msg-bubble">'+escapeHtml(text).replace(/\n/g,'<br>')+imgHtml+'</div><div class="msg-meta">你 · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`,
   `return '<div class="msg user"><div class="chat-sender">你</div><div class="msg-bubble">'+escapeHtml(text).replace(/\n/g,'<br>')+imgHtml+'</div><div class="msg-meta">你 · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`],
  // 2) 历史 assistant：顶部发送者名（绑定专家时显示专家名）+ meta 动态
  [`return '<div class="msg assistant" data-content="'+esc(text).replace(/"/g,'&quot;').replace(/\n/g,'&#10;')+'"><div class="msg-bubble">'+renderMarkdown(text)+imgHtml+toolsHtml+'</div>'+actionsHtml+'<div class="msg-meta">Hermes · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`,
   `return '<div class="msg assistant" data-content="'+esc(text).replace(/"/g,'&quot;').replace(/\n/g,'&#10;')+'"><div class="chat-sender">'+chatSenderName()+'</div><div class="msg-bubble">'+renderMarkdown(text)+imgHtml+toolsHtml+'</div>'+actionsHtml+'<div class="msg-meta">'+chatSenderName()+' · '+fmtDateTime(m.ts||m.created_at||Date.now())+'</div></div>';`],
  // 3) 流式回复创建：顶部发送者 + meta 动态
  [`  asst.innerHTML = '<div class="msg-bubble"><div class="md-text"><span class="cursor-blink">|</span></div><div class="chat-info"></div><div class="tool-calls" data-collapsed="true"'+_tcStyle+'><div class="tool-summary" onclick="toggleToolCalls(this.parentNode)"><span class="tc-ico">🛠</span><span class="tc-text">工具调用</span><span class="tc-toggle">展开 ▾</span></div><div class="tool-list"></div></div></div><div class="msg-meta">Hermes · '+fmtDateTime(Date.now())+'</div>';`,
   `  asst.innerHTML = '<div class="chat-sender">'+chatSenderName()+'</div><div class="msg-bubble"><div class="md-text"><span class="cursor-blink">|</span></div><div class="chat-info"></div><div class="tool-calls" data-collapsed="true"'+_tcStyle+'><div class="tool-summary" onclick="toggleToolCalls(this.parentNode)"><span class="tc-ico">🛠</span><span class="tc-text">工具调用</span><span class="tc-toggle">展开 ▾</span></div><div class="tool-list"></div></div></div><div class="msg-meta">'+chatSenderName()+' · '+fmtDateTime(Date.now())+'</div>';`],
  // 4) 流式 meta 更新（usage tokens）
  [`          meta.textContent = 'Hermes · '+fmtDateTime(Date.now())+' · ' + t + ' tokens';`,
   `          meta.textContent = chatSenderName()+' · '+fmtDateTime(Date.now())+' · ' + t + ' tokens';`],
  // 5) 发送时 user 消息（8329）
  [`  userDiv.innerHTML='<div class="msg-bubble">'+escapeHtml(userText).replace(/\n/g,'<br>')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`,
   `  userDiv.innerHTML='<div class="chat-sender">你</div><div class="msg-bubble">'+escapeHtml(userText).replace(/\n/g,'<br>')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`],
  // 6) 发送时 user 消息（8969）
  [`  userDiv.innerHTML = '<div class="msg-bubble">'+quoteHtml+redirectTag+escapeHtml(text).replace(/\n/g,'<br>')+(chips?'<div style="margin-top:6px">'+chips+'</div>':'')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`,
   `  userDiv.innerHTML = '<div class="chat-sender">你</div><div class="msg-bubble">'+quoteHtml+redirectTag+escapeHtml(text).replace(/\n/g,'<br>')+(chips?'<div style="margin-top:6px">'+chips+'</div>':'')+'</div><div class="msg-meta">你 · '+fmtDateTime(Date.now())+'</div>';`],
];
for (const [o, n] of reps) {
  if (s.includes(o)) { s = s.replace(o, n, 1); c++; console.log("patched:", c); }
  else console.log("MISS:", o.slice(0, 60));
}
fs.writeFileSync(p, s);
console.log("total", c);
