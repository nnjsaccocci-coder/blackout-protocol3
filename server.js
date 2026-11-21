'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET','POST'] } });
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/health', (_req, res) => res.json({ ok: true, name: 'Blackout Protocol' }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const MIN_PLAYERS = 5, MAX_PLAYERS = 10;
const ROLE_INFO = {
  'Cell Operative': { team: 'CELL', description: 'Recognize the other Cell Operatives. The Cell may attempt to remove the Blackout Token during Intelligence.' },
  'Handler': { team: 'AGENCY', description: 'During Intelligence, you are shown the Cell Operatives.' },
  'Double Agent': { team: 'INDEPENDENT', description: 'Secretly view one player. You win alone if that player is eliminated and you survive.' },
  'Signals Analyst': { team: 'AGENCY', description: 'During Intelligence, inspect one Protocol Stack card or one player card.' },
  'Field Operative': { team: 'AGENCY', description: 'During Disruption, swap your card with another player and view the card you receive.' },
  'Case Officer': { team: 'AGENCY', description: 'During Disruption, swap two other players’ cards without looking.' },
  'Dead Drop Specialist': { team: 'CELL', description: 'During Disruption, swap your card with a Protocol Stack card without looking.' },
  'Watcher': { team: 'AGENCY', description: 'At the end, inspect your final card.' },
  'Civilian': { team: 'AGENCY', description: 'You have no special night action. Find and eliminate a Cell Operative.' }
};
const STACK = ['ENCRYPTED FILE','BURN NOTICE','FALSE SIGNAL','DEAD LETTER','REDIRECT','COLD TRAIL'];
const rooms = new Map();
const clean = s => String(s || '').trim().replace(/[^a-z0-9_-]/gi,'').slice(0,12).toUpperCase();
const shuffle = a => { const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; };
function roomOf(socket){ return rooms.get(socket.data.roomCode); }
function publicRoom(room){ return { code:room.code, hostId:room.hostId, status:room.status, phase:room.phase, round:room.round, players:room.players.map(p=>({id:p.id,name:p.name,connected:p.connected,alive:p.alive,ready:p.ready})), stack:room.stack.map((c,i)=>({id:i,name:c.name})), votes:Object.keys(room.votes).length, minPlayers:MIN_PLAYERS,maxPlayers:MAX_PLAYERS }; }
function sendRoom(room){ io.to(room.code).emit('roomState', publicRoom(room)); }
function sendPrivate(room){ for(const p of room.players){ if(p.connected) io.to(p.id).emit('privateState',{role:p.role||null,roleInfo:p.role?ROLE_INFO[p.role]:null,finalRole:p.finalRole||null,notes:p.notes||[],myVote:room.votes[p.id]||null,actions:room.actions[p.id]||{}}); } }
function addLog(room,message){ room.log.push({message,at:Date.now()}); room.log=room.log.slice(-40); io.to(room.code).emit('gameLog',room.log); }
function makeRoom(code,host){ return {code,hostId:host,status:'lobby',phase:'lobby',round:0,players:[],stack:[],votes:{},actions:{},log:[],blackoutPresent:true}; }
function distribute(room){
  const n=room.players.length; const roles=['Cell Operative','Handler','Double Agent','Signals Analyst','Field Operative','Case Officer','Dead Drop Specialist','Watcher'];
  while(roles.length<n) roles.push('Civilian');
  const shuffled=shuffle(roles); room.players.forEach((p,i)=>{p.role=shuffled[i];p.finalRole=p.role;p.alive=true;p.ready=false;p.notes=[];});
  room.stack=shuffle(STACK).map((name,i)=>({id:i,name})); room.votes={};room.actions={};room.blackoutPresent=true;room.status='playing';room.phase='intelligence';room.round=1;
}
function finish(room){
  const eliminated=room.players.filter(p=>!p.alive); const cellAlive=room.players.some(p=>p.alive && ['Cell Operative','Dead Drop Specialist'].includes(p.finalRole));
  const agencyWin=eliminated.some(p=>['Cell Operative','Dead Drop Specialist'].includes(p.finalRole)) && room.blackoutPresent;
  const cellWin=!eliminated.some(p=>['Cell Operative','Dead Drop Specialist'].includes(p.finalRole)) || !room.blackoutPresent;
  let winner=agencyWin?'AGENCY':cellWin?'CELL':'NO CLEAR WIN';
  const da=room.players.find(p=>p.role==='Double Agent'); if(da){const target=room.players.find(p=>p.id===da.actions?.targetId); if(target && !target.alive && da.alive) winner='DOUBLE AGENT';}
  room.status='finished';room.phase='results';addLog(room,`Round complete. ${winner} wins.`);io.to(room.code).emit('results',{winner,eliminated:eliminated.map(p=>p.name),blackoutPresent:room.blackoutPresent,players:room.players.map(p=>({name:p.name,role:p.finalRole,alive:p.alive}))});
}
function nextPhase(room){
 if(room.phase==='intelligence'){room.phase='disruption';addLog(room,'Intelligence complete. Disruption begins.');}
 else if(room.phase==='disruption'){room.phase='discussion';addLog(room,'Disruption complete. Discuss the evidence, then vote.');}
 else if(room.phase==='discussion'){room.phase='voting';room.votes={};addLog(room,'Voting is open. Each living player may cast one vote.');}
 else if(room.phase==='voting'){
  const counts={};for(const [voter,target] of Object.entries(room.votes)){if(target)counts[target]=(counts[target]||0)+1;}
  const max=Math.max(0,...Object.values(counts));const leaders=Object.keys(counts).filter(id=>counts[id]===max);
  if(max>0 && leaders.length===1){const target=room.players.find(p=>p.id===leaders[0]);if(target){target.alive=false;addLog(room,`${target.name} was eliminated by the vote.`);}}
  else addLog(room,'The vote was tied or no votes were cast. No one was eliminated.');
  finish(room);return;
 }
 sendRoom(room);sendPrivate(room);
}
io.on('connection', socket=>{
 socket.on('createRoom',({name})=>{
  const playerName=String(name||'').trim().slice(0,20)||'Host';let code;do{code=Math.random().toString(36).slice(2,7).toUpperCase();}while(rooms.has(code));
  const room=makeRoom(code,socket.id);room.players.push({id:socket.id,name:playerName,connected:true,alive:true,ready:true,notes:[]});rooms.set(code,room);socket.data.roomCode=code;socket.join(code);socket.emit('joined',{id:socket.id,code});sendRoom(room);addLog(room,`${playerName} created the room.`);
 });
 socket.on('joinRoom',({code,name})=>{
  code=clean(code);const room=rooms.get(code);if(!room)return socket.emit('errorMessage','Room not found. Check the code.');
  if(room.status!=='lobby')return socket.emit('errorMessage','This game has already started.');
  if(room.players.length>=MAX_PLAYERS)return socket.emit('errorMessage','This room is full (10 players maximum).');
  if(room.players.some(p=>p.name.toLowerCase()===String(name||'').trim().toLowerCase()))return socket.emit('errorMessage','That player name is already taken in this room.');
  const playerName=String(name||'').trim().slice(0,20)||`Agent ${room.players.length+1}`;room.players.push({id:socket.id,name:playerName,connected:true,alive:true,ready:true,notes:[]});socket.data.roomCode=code;socket.join(code);socket.emit('joined',{id:socket.id,code});addLog(room,`${playerName} joined the room.`);sendRoom(room);
 });
 socket.on('startGame',()=>{const r=roomOf(socket);if(!r)return;if(socket.id!==r.hostId)return socket.emit('errorMessage','Only the host can start the game.');if(r.players.length<MIN_PLAYERS)return socket.emit('errorMessage',`You need at least ${MIN_PLAYERS} players.`);distribute(r);addLog(r,'Roles have been secretly assigned. Intelligence phase begins.');sendRoom(r);sendPrivate(r);});
 socket.on('advancePhase',()=>{const r=roomOf(socket);if(!r)return;if(socket.id!==r.hostId)return socket.emit('errorMessage','Only the host can advance the phase.');if(r.status!=='playing')return;nextPhase(r);});
 socket.on('nightAction',({type,targetId,stackId,secondTargetId})=>{
  const r=roomOf(socket);if(!r||r.status!=='playing')return;const p=r.players.find(x=>x.id===socket.id);if(!p||!p.alive)return;
  const alive=r.players.filter(x=>x.alive);const target=r.players.find(x=>x.id===targetId&&x.alive);let message='';
  if(type==='doubleAgent'&&p.role==='Double Agent'&&r.phase==='intelligence'&&target&&target.id!==p.id){p.actions={...(p.actions||{}),targetId};p.notes.push(`You secretly viewed ${target.name}'s identity.`);p.notes.push(`Their role is ${target.role}.`);message=`${target.name}: ${target.role}`;}
  else if(type==='signalsPlayer'&&p.role==='Signals Analyst'&&r.phase==='intelligence'&&target){p.notes.push(`Signals check: ${target.name} is ${target.role}.`);message=`${target.name}: ${target.role}`;}
  else if(type==='signalsStack'&&p.role==='Signals Analyst'&&r.phase==='intelligence'&&Number.isInteger(stackId)&&r.stack[stackId]){p.notes.push(`Signals check: Protocol Stack card ${stackId+1} is ${r.stack[stackId].name}.`);message=r.stack[stackId].name;}
  else if(type==='removeToken'&&p.role==='Cell Operative'&&r.phase==='intelligence'&&r.blackoutPresent){r.blackoutPresent=false;message='Blackout Token removed.';addLog(r,'The Blackout Token was removed.');}
  else if(type==='fieldSwap'&&p.role==='Field Operative'&&r.phase==='disruption'&&target&&target.id!==p.id){const a=p.finalRole;p.finalRole=target.finalRole;target.finalRole=a;p.notes.push(`You swapped with ${target.name}. Your received card is ${p.finalRole}.`);message=`Your new card: ${p.finalRole}`;}
  else if(type==='caseSwap'&&p.role==='Case Officer'&&r.phase==='disruption'&&target&&secondTargetId&&target.id!==secondTargetId){const b=r.players.find(x=>x.id===secondTargetId&&x.alive);if(b&&b.id!==p.id){const a=target.finalRole;target.finalRole=b.finalRole;b.finalRole=a;message='Two player cards swapped without being revealed.';}}
  else if(type==='deadDropSwap'&&p.role==='Dead Drop Specialist'&&r.phase==='disruption'&&Number.isInteger(stackId)&&r.stack[stackId]){const a=p.finalRole;p.finalRole=r.stack[stackId].name;r.stack[stackId].name=a;message='Your card was swapped with a Protocol Stack card.';}
  else if(type==='watcherCheck'&&p.role==='Watcher'&&r.phase==='results'){message=`Your final card: ${p.finalRole}`;p.notes.push(message);}
  else return socket.emit('errorMessage','That action is not available for your role or this phase.');
  if(message)socket.emit('actionResult',message);sendPrivate(r);sendRoom(r);
 });
 socket.on('castVote',({targetId})=>{const r=roomOf(socket);if(!r||r.phase!=='voting')return;const p=r.players.find(x=>x.id===socket.id);const t=r.players.find(x=>x.id===targetId&&x.alive);if(!p||!p.alive||!t||t.id===p.id)return socket.emit('errorMessage','Choose another living player.');r.votes[p.id]=targetId;sendRoom(r);sendPrivate(r);addLog(r,`${p.name} has submitted a vote.`);});
 socket.on('leaveRoom',()=>leave(socket));socket.on('disconnect',()=>leave(socket));
});
function leave(socket){const r=roomOf(socket);if(!r)return;const p=r.players.find(x=>x.id===socket.id);if(p){p.connected=false;if(r.status==='lobby'){r.players=r.players.filter(x=>x.id!==socket.id);if(r.hostId===socket.id&&r.players[0])r.hostId=r.players[0].id;}else p.alive=false;addLog(r,`${p.name} disconnected.`);if(!r.players.length)rooms.delete(r.code);else sendRoom(r);}socket.data.roomCode=null;}
server.listen(PORT,'0.0.0.0',()=>console.log(`Blackout Protocol listening on ${PORT}`));
