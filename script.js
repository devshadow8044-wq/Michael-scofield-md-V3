const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const DEFAULT={
 name:"DEV MICHAEL SCOFIELD", sub:"CRÉÉ PAR PAPINO", title:"CHECK BAN",
 ok:"NUMÉRO NON SIGNALÉ COMME BANNI", ban:"NUMÉRO SIGNALÉ COMME BANNI",
 channel:"https://whatsapp.com/channel/0029VbDsfDvKWEL0VT5hBu2C",
 group:"https://chat.whatsapp.com/BeSz9RNgCjcH5CVhZu830J?s=cl&p=a&mlu=4&ilr=4",
 contact:"https://wa.me/?text=Salut%20Papino", api:"", theme:"neon"
};
// Nouvelle clé : évite que l'ancienne config (LORD DÉMON YACKUZA / blood) écrase les changements
let cfg=Object.assign({},DEFAULT,JSON.parse(localStorage.getItem("scofield-v1-config")||"{}"));
let history=JSON.parse(localStorage.getItem("scofield-v1-history")||"[]");
let media={video:null,image:null,audio:null};

function validDigits(v){return v.replace(/\D/g,"")}
function normalize(){
 const rawPrefix=$("#country").value.trim();
 const prefix=rawPrefix.replace(/[^+\d]/g,"");
 const d=validDigits($("#phone").value);
 if(!/^\+?\d{1,4}$/.test(prefix)||!d||d.length<4)return null;
 const cc=prefix.startsWith("+")?prefix:"+"+prefix;
 return cc+d;
}
function render(){
 document.body.dataset.theme=cfg.theme;
 $("#brandName").textContent=cfg.name; $("#footerName").textContent=cfg.name; $("#brandSub").textContent=cfg.sub;
 $("#pageTitle").textContent=cfg.title;
 $("#channelLink").href=cfg.channel; $("#groupLink").href=cfg.group; $("#contactLink").href=cfg.contact;
 $("#setName").value=cfg.name;$("#setSub").value=cfg.sub;$("#setTitle").value=cfg.title;$("#setOk").value=cfg.ok;$("#setBan").value=cfg.ban;
 $("#setChannel").value=cfg.channel;$("#setGroup").value=cfg.group;$("#setContact").value=cfg.contact;$("#setApi").value=cfg.api;
 $$("[data-theme]").forEach(x=>x.classList.toggle("active",x.dataset.theme===cfg.theme));
 renderHistory();
}
function renderHistory(){
 const el=$("#historyList"); if(!history.length){el.innerHTML='<div class="empty">Aucune vérification enregistrée.</div>';return}
 el.innerHTML=history.slice(0,50).map((x,i)=>`<div class="hist"><div><b>${x.num}</b><small>${new Date(x.ts).toLocaleString()}</small></div><span class="badge ${x.banned?'ban':'ok'}">${x.banned?'BANNED':'OK'}</span></div>`).join("");
}
function saveHistory(num,banned){
 history.unshift({num,banned,ts:Date.now()});history=history.slice(0,50);
 localStorage.setItem("scofield-v1-history",JSON.stringify(history));renderHistory();
}
function setResult(kind,title,text){
 const r=$("#result");r.className="result "+kind;$("#resultTitle").textContent=title;$("#resultText").textContent=text;
 $("#resultIcon").textContent=kind==="ok"?"✓":kind==="ban"?"!":"◈";
}
async function check(){
 const num=normalize(), err=$("#inputError");err.textContent="";err.classList.remove("show");
 if(!num){err.textContent="Indicatif invalide ou numéro incomplet. Écris l’indicatif international (ex. +241) puis le numéro sans répéter cet indicatif.";err.classList.add("show");return}
 $("#checkBtn").disabled=true;setResult("busy","ANALYSE EN COURS","Connexion au système…");
 try{
   if(cfg.api){
     const res=await fetch(cfg.api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:num})});
     if(!res.ok) throw new Error("API");
     const data=await res.json();
     if(typeof data.banned!=="boolean"){
       setResult("idle","STATUT INDÉTERMINÉ","La source n’a pas renvoyé un état de bannissement explicite. Aucun verdict n’a été enregistré.");
       return;
     }
     const banned=data.banned, reason=typeof data.reason==="string"?data.reason:"";
     saveHistory(num,banned);setResult(banned?"ban":"ok",banned?"BANNED":"NON SIGNALÉ COMME BANNI",reason||(banned?cfg.ban:cfg.ok));
   }else{
     await new Promise(r=>setTimeout(r,850));
     setResult("ok","MODE LOCAL",`Format valide : ${num}. Aucun état WhatsApp réel n'est interrogé.`);
   }
 }catch(e){setResult("idle","ERREUR API","Impossible de joindre l’API configurée.");}
 finally{$("#checkBtn").disabled=false}
}
function loadMedia(){
 if(media.video){$("#bgVideo").src=media.video;$("#bgVideo").style.display="block";$("#bgImage").style.display="none";$("#bgVideo").play().catch(()=>{})}
 else if(media.image){$("#bgImage").src=media.image;$("#bgImage").style.display="block";$("#bgVideo").style.display="none"}
}
function readFile(input,cb){const f=input.files[0];if(!f)return;const r=new FileReader();r.onload=()=>cb(r.result);r.readAsDataURL(f)}
$("#enterBtn").onclick=()=>{$("#intro").classList.add("hide");setTimeout(()=>$("#intro").remove(),700)};
$("#menuBtn").onclick=()=>$("#menu").classList.toggle("open");
$("#menuClose").onclick=()=>$("#menu").classList.remove("open");
$$("[data-go]").forEach(b=>b.onclick=()=>{document.getElementById(b.dataset.go).scrollIntoView({behavior:"smooth"});$("#menu").classList.remove("open")});
$("#settingsBtn").onclick=()=>{$("#menu").classList.remove("open");$("#settings").classList.add("show")};
$("#closeSettings").onclick=()=>$("#settings").classList.remove("show");
$("#settings").onclick=e=>{if(e.target===$("#settings"))$("#settings").classList.remove("show")};
$("#checkBtn").onclick=check;$("#phone").onkeydown=e=>{if(e.key==="Enter")check()};
$("#clearHistory").onclick=()=>{history=[];localStorage.removeItem("scofield-v1-history");renderHistory()};
$("#saveSettings").onclick=()=>{
 cfg.name=$("#setName").value.trim()||DEFAULT.name;cfg.sub=$("#setSub").value.trim()||DEFAULT.sub;cfg.title=$("#setTitle").value.trim()||DEFAULT.title;
 cfg.ok=$("#setOk").value.trim()||DEFAULT.ok;cfg.ban=$("#setBan").value.trim()||DEFAULT.ban;
 cfg.channel=$("#setChannel").value.trim()||DEFAULT.channel;cfg.group=$("#setGroup").value.trim()||DEFAULT.group;cfg.contact=$("#setContact").value.trim()||DEFAULT.contact;cfg.api=$("#setApi").value.trim(); 
 cfg.theme=[...$$(".themes button")].find(x=>x.classList.contains("active"))?.dataset.theme||cfg.theme;
 localStorage.setItem("scofield-v1-config",JSON.stringify(cfg));render();$("#settings").classList.remove("show");
};
$("#resetSettings").onclick=()=>{cfg=Object.assign({},DEFAULT);localStorage.setItem("scofield-v1-config",JSON.stringify(cfg));render()};
$$(".themes button").forEach(b=>b.onclick=()=>{$$(".themes button").forEach(x=>x.classList.remove("active"));b.classList.add("active");cfg.theme=b.dataset.theme;document.body.dataset.theme=cfg.theme});
$("#videoInput").onchange=e=>readFile(e.target,x=>{media.video=x;media.image=null;loadMedia()});
$("#imageInput").onchange=e=>readFile(e.target,x=>{media.image=x;media.video=null;loadMedia()});
$("#audioInput").onchange=e=>readFile(e.target,x=>{media.audio=x;$("#music").src=x;$("#music").play().catch(()=>{});$("#musicBtn").textContent="Ⅱ"});
$("#musicBtn").onclick=()=>{const m=$("#music");if(!m.src)return; if(m.paused){m.play();$("#musicBtn").textContent="Ⅱ"}else{m.pause();$("#musicBtn").textContent="♫"}};
$("#resetMedia").onclick=()=>{$("#bgVideo").pause();$("#bgVideo").removeAttribute("src");$("#bgImage").removeAttribute("src");$("#bgVideo").style.display="none";$("#bgImage").style.display="none";media={video:null,image:null,audio:null};$("#music").pause();$("#music").removeAttribute("src");$("#musicBtn").textContent="♫"};
render();

// Araignées qui tombent : toucher ou cliquer pour les écraser.
(function spiderRain(){
 const layer=$("#spiderLayer"); if(!layer)return;
 const glyphs=["🕷️","🕸️","🕷"];
 function spawnSpider(){
   if(document.hidden)return;
   const s=document.createElement("button");
   s.type="button";s.className="fallingSpider";s.textContent=glyphs[Math.floor(Math.random()*glyphs.length)];
   s.setAttribute("aria-label","Écraser l’araignée");s.title="Toucher pour écraser";
   s.style.setProperty("--x",Math.random()*96+"vw");
   s.style.setProperty("--size",(18+Math.random()*17)+"px");
   const duration=7+Math.random()*8;s.style.setProperty("--duration",duration+"s");
   s.addEventListener("click",()=>{if(s.classList.contains("squashed"))return;s.classList.add("squashed");setTimeout(()=>s.remove(),260)});
   s.addEventListener("animationend",e=>{if(e.animationName==="spiderFall")s.remove()});
   layer.appendChild(s);
   setTimeout(()=>{if(s.isConnected)s.remove()},(duration+1)*1000);
 }
 for(let i=0;i<5;i++)setTimeout(spawnSpider,i*550);
 setInterval(spawnSpider,850);
})();
