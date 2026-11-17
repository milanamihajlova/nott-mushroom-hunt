import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const root=path.dirname(fileURLToPath(import.meta.url));
const app=express();const server=http.createServer(app);const io=new Server(server,{cors:{origin:'*'}});
app.use('/vendor',express.static(path.join(root,'node_modules','three','build')));
app.use(express.static(path.join(root,'public')));
app.get('/health',(req,res)=>res.json({ok:true,players:players.size,mushrooms:mushrooms.length}));
const DATA=process.env.DATA_DIR||root;const SAVE=path.join(DATA,'players.json');
let accounts={};try{accounts=JSON.parse(fs.readFileSync(SAVE,'utf8'))}catch{}
let saveTimer;function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{fs.mkdirSync(DATA,{recursive:true});fs.writeFileSync(SAVE,JSON.stringify(accounts,null,2))}catch(e){console.error('save failed',e.message)}},400)}
const players=new Map(),mushrooms=[];const TYPES=[{name:'Лесная',points:1,weight:58,color:0xD8B58C},{name:'Лунная',points:3,weight:25,color:0x78C9FF},{name:'Теневая',points:5,weight:13,color:0xA58AE8},{name:'Золотая',points:10,weight:4,color:0xF5C65B}];
const WALLS=[[-15,0,3,16],[15,0,3,16],[0,-15,33,3],[0,15,33,3],[-5,-4,2,9],[6,5,2,9],[-8,9,9,2],[9,-8,9,2]];
function valid(x,z){if(Math.abs(x)>13||Math.abs(z)>13)return false;return !WALLS.some(([a,b,w,h])=>Math.abs(x-a)<w/2+.55&&Math.abs(z-b)<h/2+.55)}
function spot(){for(let i=0;i<150;i++){let x=(Math.random()-.5)*25,z=(Math.random()-.5)*25;if(valid(x,z)&&Math.hypot(x,z)>2.4)return{x:+x.toFixed(2),z:+z.toFixed(2)}}return{x:0,z:3}}
function spawn(){let n=Math.random()*100,acc=0,t=0;for(let i=0;i<TYPES.length;i++){acc+=TYPES[i].weight;if(n<acc){t=i;break}}let p=spot();return{id:crypto.randomUUID(),type:t,x:p.x,z:p.z,born:Date.now(),phase:Math.random()*6.28}}
for(let i=0;i<26;i++)mushrooms.push(spawn());
function leaderboard(){return Object.entries(accounts).map(([key,a])=>({name:a.name,score:a.score||0,found:a.found||0})).sort((a,b)=>b.score-a.score).slice(0,20)}
function publicPlayer(p){return{id:p.id,name:p.name,x:p.x,z:p.z,rot:p.rot,look:p.look}}
function snapshot(){return{players:[...players.values()].map(publicPlayer),mushrooms,leaders:leaderboard(),online:players.size}}
function cleanName(v){return String(v||'').trim().replace(/[<>]/g,'').slice(0,22)}
io.on('connection',socket=>{
 let player=null,accountKey=null,lastMove=0,lastCatch=0;
 socket.on('login',(data,cb)=>{if(player)return;const name=cleanName(data?.name),pin=String(data?.pin||'');if(name.length<2||pin.length<4||pin.length>40)return cb?.({error:'Имя от 2 символов, секретный код от 4 до 40 символов.'});const key=name.toLocaleLowerCase('ru');let a=accounts[key];if(a){if(crypto.scryptSync(pin,a.salt,32).toString('hex')!==a.hash)return cb?.({error:'Неверный секретный код для этого имени.'})}else{let salt=crypto.randomBytes(16).toString('hex');a={name,salt,hash:crypto.scryptSync(pin,salt,32).toString('hex'),look:{house:'slytherin',hair:'dark',skin:'light',style:'short',robe:'uniform'},score:0,found:0,collection:[0,0,0,0]};accounts[key]=a;save()}
 if([...players.values()].some(p=>p.key===key))return cb?.({error:'Этот персонаж уже находится в игре.'});accountKey=key;let p=spot();player={id:socket.id,key,name:a.name,x:p.x,z:p.z,rot:0,look:a.look};players.set(socket.id,player);socket.emit('init',{you:socket.id,account:{name:a.name,look:a.look,score:a.score,found:a.found,collection:a.collection},...snapshot()});socket.broadcast.emit('playerJoined',publicPlayer(player));cb?.({ok:true});});
 socket.on('appearance',(look,cb)=>{if(!player)return;const allowed={house:['slytherin','hufflepuff','ravenclaw','gryffindor'],hair:['dark','brown','blond','red','silver'],skin:['light','tan','deep'],style:['short','long','bun'],robe:['uniform','cloak']};let next={};for(let k in allowed)next[k]=allowed[k].includes(look?.[k])?look[k]:allowed[k][0];accounts[accountKey].look=next;player.look=next;save();io.emit('appearance',{id:player.id,look:next});cb?.({ok:true})});
 socket.on('move',d=>{if(!player||Date.now()-lastMove<35)return;let now=Date.now(),dt=Math.min((now-lastMove)/1000,.22);lastMove=now;let x=Number(d?.x),z=Number(d?.z),rot=Number(d?.rot);if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(rot))return;let dist=Math.hypot(x-player.x,z-player.z);if(dist>Math.max(.7,dt*8.5)||!valid(x,z))return;player.x=x;player.z=z;player.rot=rot;socket.broadcast.emit('playerMove',{id:player.id,x,z,rot})});
 socket.on('catch',(id,cb)=>{if(!player||Date.now()-lastCatch<650)return cb?.({error:'Подожди немного.'});lastCatch=Date.now();let i=mushrooms.findIndex(m=>m.id===id);if(i<0)return cb?.({error:'Поганка уже исчезла.'});let m=mushrooms[i];if(Math.hypot(player.x-m.x,player.z-m.z)>2.1)return cb?.({error:'Подойди ближе к поганке.'});let a=accounts[accountKey];a.score+=TYPES[m.type].points;a.found++;a.collection[m.type]++;save();mushrooms.splice(i,1);io.emit('mushroomGone',id);socket.emit('reward',{type:m.type,points:TYPES[m.type].points,score:a.score,found:a.found,collection:a.collection});io.emit('leaders',leaderboard());cb?.({ok:true})});
 socket.on('disconnect',()=>{if(player){players.delete(socket.id);io.emit('playerLeft',socket.id);io.emit('online',players.size)}});
});
setInterval(()=>{while(mushrooms.length<26){let m=spawn();mushrooms.push(m);io.emit('mushroomNew',m)}for(let i=mushrooms.length-1;i>=0;i--)if(Date.now()-mushrooms[i].born>120000){let old=mushrooms.splice(i,1)[0];io.emit('mushroomGone',old.id)}},2500);
setInterval(()=>{for(let m of mushrooms){if(Math.random()<.16){let x=m.x+(Math.random()-.5)*2,z=m.z+(Math.random()-.5)*2;if(valid(x,z)){m.x=+x.toFixed(2);m.z=+z.toFixed(2);io.emit('mushroomMove',{id:m.id,x:m.x,z:m.z})}}}},2200);
process.on('SIGTERM',()=>{clearTimeout(saveTimer);try{fs.mkdirSync(DATA,{recursive:true});fs.writeFileSync(SAVE,JSON.stringify(accounts,null,2))}catch{}server.close(()=>process.exit(0))});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Nott Hunt listening',process.env.PORT||3000));
