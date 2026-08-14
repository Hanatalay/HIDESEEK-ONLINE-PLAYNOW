const express=require("express");
const http=require("http");
const path=require("path");
const {WebSocketServer,WebSocket}=require("ws");

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server});
const PORT=process.env.PORT||10000;
const rooms=new Map();
const MIN=2,MAX=4,ROUND=30;

app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(_,res)=>res.json({ok:true,rooms:rooms.size}));

const send=(ws,x)=>ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify(x));
const broadcast=(r,x)=>r.players.forEach(p=>send(p.ws,x));
const cleanName=x=>String(x||"Player").replace(/[^\w -]/g,"").trim().slice(0,16)||"Player";
const cleanSkin=x=>["blue","red","green","purple","gold"].includes(x)?x:"blue";
const id=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-5);
function newCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(rooms.has(c));return c}
function publicRoom(r){return {type:"lobby",code:r.code,hostId:r.hostId,players:r.players.map(p=>({id:p.id,name:p.name,skin:p.skin,role:p.role,x:p.x,y:p.y,hidden:p.hidden})),min:MIN,max:MAX}}
function leave(ws){
  if(!ws.room)return;
  const r=rooms.get(ws.room);if(!r)return;
  r.players=r.players.filter(p=>p.ws!==ws);
  if(r.hostId===ws.playerId){
    broadcast(r,{type:"closed",reason:"The host left the lobby."});rooms.delete(r.code);return;
  }
  broadcast(r,publicRoom(r));
  ws.room=null;ws.playerId=null;
}
function end(r,result){
  if(!r.running)return;
  r.running=false;
  const winners=result==="win"?r.players.filter(p=>p.role==="hider").map(p=>p.id):[];
  broadcast(r,{type:"roundEnd",result,winners});
}
function tick(){
  for(const r of rooms.values()){
    if(!r.running)continue;
    const seeker=r.players.find(p=>p.role==="seeker");
    if(!seeker)continue;
    const visible=r.players.filter(p=>p.role==="hider"&&!p.hidden);
    if(visible.length){
      const target=visible.reduce((a,b)=>Math.hypot(a.x-seeker.x,a.y-seeker.y)<Math.hypot(b.x-seeker.x,b.y-seeker.y)?a:b);
      const dx=target.x-seeker.x,dy=target.y-seeker.y,d=Math.hypot(dx,dy)||1;
      seeker.x+=dx/d*2.2;seeker.y+=dy/d*2.2;
      if(Math.hypot(target.x-seeker.x,target.y-seeker.y)<25){end(r,"caught");continue}
    }
    if(Date.now()>=r.endsAt)end(r,"win");
  }
}
setInterval(tick,50);

wss.on("connection",ws=>{
  ws.on("error",()=>{});
  ws.on("message",raw=>{
    let d;try{d=JSON.parse(raw)}catch{return send(ws,{type:"error",message:"Bad request."})}

    if(d.type==="create"){
      if(ws.room)return;
      const code=newCode(),pid=id();
      const p={id:pid,ws,name:cleanName(d.name),skin:cleanSkin(d.skin),role:"",x:450,y:470,hidden:false};
      const r={code,hostId:pid,players:[p],running:false,endsAt:0};
      rooms.set(code,r);ws.room=code;ws.playerId=pid;
      send(ws,{type:"created",code,id:pid});send(ws,publicRoom(r));return;
    }

    if(d.type==="join"){
      if(ws.room)return;
      const code=String(d.code||"").replace(/\D/g,"");
      const r=rooms.get(code);
      if(!r)return send(ws,{type:"error",message:"Room not found. Check the code."});
      if(r.running)return send(ws,{type:"error",message:"That game has already started."});
      if(r.players.length>=MAX)return send(ws,{type:"error",message:"That lobby is full."});
      const pid=id();
      r.players.push({id:pid,ws,name:cleanName(d.name),skin:cleanSkin(d.skin),role:"",x:150+r.players.length*150,y:430,hidden:false});
      ws.room=code;ws.playerId=pid;
      send(ws,{type:"joined",code,id:pid});broadcast(r,publicRoom(r));return;
    }

    const r=rooms.get(ws.room);if(!r)return send(ws,{type:"error",message:"You are not in a lobby."});
    const p=r.players.find(x=>x.id===ws.playerId);if(!p)return;

    if(d.type==="start"){
      if(r.hostId!==p.id)return send(ws,{type:"error",message:"Only the host can start."});
      if(r.players.length<MIN)return send(ws,{type:"error",message:"At least 2 players are required."});
      const seeker=r.players[Math.floor(Math.random()*r.players.length)];
      r.players.forEach((x,i)=>{x.role=x===seeker?"seeker":"hider";x.hidden=false;x.x=x.role==="seeker"?450:100+(i*170)%700;x.y=x.role==="seeker"?80:400});
      r.running=true;r.endsAt=Date.now()+ROUND*1000;
      broadcast(r,{type:"start",code:r.code,time:ROUND,players:r.players.map(x=>({id:x.id,name:x.name,skin:x.skin,role:x.role,x:x.x,y:x.y,hidden:x.hidden}))});
      return;
    }

    if(d.type==="move"&&r.running){
      p.x=Math.max(20,Math.min(880,Number(d.x)||p.x));
      p.y=Math.max(20,Math.min(530,Number(d.y)||p.y));
      p.hidden=!!d.hidden;p.skin=cleanSkin(d.skin);
      broadcast(r,{type:"state",time:Math.max(0,Math.ceil((r.endsAt-Date.now())/1000)),players:r.players.map(x=>({id:x.id,name:x.name,skin:x.skin,role:x.role,x:x.x,y:x.y,hidden:x.hidden}))});
      return;
    }

    if(d.type==="leave")leave(ws);
  });
  ws.on("close",()=>leave(ws));
});
server.listen(PORT,"0.0.0.0",()=>console.log("HIDESEEK server on "+PORT));
