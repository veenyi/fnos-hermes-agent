import fs from "fs";
const p = "index.html";
const lines = fs.readFileSync(p, "utf8").split("\n");
// 7192 历史 user
let l = lines[7191];
if (l.includes('msg user"><div class="msg-bubble">')) { lines[7191] = l.replace('msg user"><div class="msg-bubble">', 'msg user"><div class="chat-sender">你</div><div class="msg-bubble">'); console.log("7192 ok"); }
// 7201 历史 assistant（顶部 sender）
l = lines[7200];
if (l.includes('data-content="') && l.includes('msg-bubble">') && !l.includes('chat-sender')) {
  lines[7200] = l.replace('"\'+\'"><div class="msg-bubble">', '"\'+\'"><div class="chat-sender">\'+chatSenderName()+\'</div><div class="msg-bubble">');
  lines[7200] = lines[7200].replace('msg-meta">Hermes · ', 'msg-meta">\'+chatSenderName()+\' · ');
  console.log("7201 ok");
}
// 8329 发送 user
l = lines[8328];
if (l.includes("userDiv.innerHTML='<div class=\"msg-bubble\">'")) { lines[8328] = l.replace("userDiv.innerHTML='<div class=\"msg-bubble\">'", "userDiv.innerHTML='<div class=\"chat-sender\">你</div><div class=\"msg-bubble\">'"); console.log("8329 ok"); }
// 8969 发送 user
l = lines[8968];
if (l.includes("userDiv.innerHTML = '<div class=\"msg-bubble\">'")) { lines[8968] = l.replace("userDiv.innerHTML = '<div class=\"msg-bubble\">'", "userDiv.innerHTML = '<div class=\"chat-sender\">你</div><div class=\"msg-bubble\">'"); console.log("8969 ok"); }
fs.writeFileSync(p, lines.join("\n"));
console.log("DONE");
