// ===== เพิ่มด้านบนสุด =====
const express = require("express");
const http = require("http");

const app = express();
const httpServer = http.createServer(app);

// เปิด port 3000
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
const { Server } = require("socket.io");
// ถ้าคุณมี express+http อยู่แล้ว สมมติชื่อ server คือ httpServer:
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// ===== ตัวช่วยแบบง่าย =====
const words = [
  "sort","touch","firewall","compile","packet","socket","cipher","vector","matrix",
  "dragon","wizard","castle","knight","crypto","daemon","system","kernel","thread"
];
function randWord(){
  return words[Math.floor(Math.random()*words.length)];
}

const queues = { // คิวตามความยาก
  "ง่าย": [],
  "ยาก": []
};
// เก็บสถานะห้องเกม
const rooms = new Map(); // roomId -> { p1:{id,name,diff,hpMul}, p2:{...}, bossHP, bossIndex }

// ===== จัดการเชื่อมต่อ =====
io.on("connection", (socket)=>{
  // ผู้เล่นเข้าคิว
  socket.on("queue:join", ({name, diff})=>{
    socket.data.name = name;
    socket.data.diff = diff;
    // เก็บเข้าคิวความยากเดียวกัน
    const q = queues[diff] || (queues[diff]=[]);
    q.push({ id: socket.id, name, diff });

    // ถ้ามีตั้งแต่ 2 คนขึ้นไป -> จับคู่
    if(q.length >= 2){
      const p1 = q.shift();
      const p2 = q.shift();
      const roomId = "room_"+Date.now()+"_"+Math.floor(Math.random()*1e4);

      // ให้ทั้งคู่ join room
      io.sockets.sockets.get(p1.id)?.join(roomId);
      io.sockets.sockets.get(p2.id)?.join(roomId);

      // สร้างสถานะเกม
      rooms.set(roomId, {
        p1:{ id:p1.id, name:p1.name, diff:p1.diff },
        p2:{ id:p2.id, name:p2.name, diff:p2.diff },
        bossHP:100,
        bossIndex:1
      });

      // แจ้งจับคู่สำเร็จ
      io.to(roomId).emit("match:found", {
        roomId,
        p1: { name:p1.name, diff:p1.diff },
        p2: { name:p2.name, diff:p2.diff },
        startIn: 3
      });
    }
  });

  // ทั้งคู่พร้อมเริ่ม
  socket.on("game:ready", ({roomId})=>{
    const R = rooms.get(roomId);
    if(!R) return;
    // แจกคำแรก และบอกเวลาเริ่ม
    io.to(roomId).emit("game:start",{ ts: Date.now() });
    io.to(roomId).emit("boss:new",{ index:R.bossIndex, name: R.bossIndex===1? "CYBER GOLEM":"DEMON" });
    io.to(roomId).emit("boss:hp",{ hp: R.bossHP });
    io.to(roomId).emit("word:new",{ word: randWord() });
  });

  // ยืนยันคำตอบ
  socket.on("word:submit", ({roomId, text, who, dmgMul})=>{
    const R = rooms.get(roomId);
    if(!R) return;
    const word = words.find(w => w.toLowerCase() === text.toLowerCase());
    const ok = !!word;
    const baseDmg = 8; // ดาเมจพื้นฐาน
    const dmg = ok ? Math.round(baseDmg*(dmgMul||1)) : 0;

    // บอกผลแก่เจ้าของก่อน
    io.to(socket.id).emit("word:result", { ok, dmg, you:true });

    if(ok){
      // หัก HP บอส
      R.bossHP = Math.max(0, R.bossHP - dmg);
      io.to(roomId).emit("boss:hp", { hp: R.bossHP });

      // โอกาสได้บัฟเล็กน้อย (10%)
      if(Math.random() < 0.10){
        const buffType = Math.random()<0.7 ? 'x2' : 'heal';
        const targetIdx = who===1?1:2;
        io.to(roomId).emit("buff:grant", { to: targetIdx, type: buffType, durMs: 5000 });
        if(buffType==='heal'){
          // Heal คือเติม HP บอส? ไม่! ต้องเติม HP ผู้เล่น แต่เรามีแต่ HP บอส
          // ดังนั้นเปลี่ยนเป็นทำให้บอสเสียเพิ่มทันทีอีกหน่อย
          R.bossHP = Math.max(0, R.bossHP - 4);
          io.to(roomId).emit("boss:hp",{ hp:R.bossHP });
        }
      }

      // เปลี่ยนคำรอบถัดไป
      io.to(roomId).emit("word:new",{ word: randWord() });

      // เช็คตาย
      if(R.bossHP === 0){
        // บอสถัดไปหรือจบ
        if(R.bossIndex >= 2){
          io.to(roomId).emit("game:end", { win:true });
          rooms.delete(roomId);
        }else{
          R.bossIndex++;
          R.bossHP = 100;
          io.to(roomId).emit("boss:new",{ index:R.bossIndex, name:"DEMON" });
          io.to(roomId).emit("boss:hp",{ hp: R.bossHP });
          io.to(roomId).emit("word:new",{ word: randWord() });
        }
      }
    } else {
      // ผิด -> แจกคำใหม่เหมือนกัน เพื่อตัดการรอ
      io.to(roomId).emit("word:new",{ word: randWord() });
    }
  });

  // ออกจากเกม/หลุด
  socket.on("disconnect", ()=>{
    // เอาออกจากคิวถ้ามี
    ["ง่าย","ยาก"].forEach(d=>{
      const q = queues[d];
      const idx = q.findIndex(x=>x.id===socket.id);
      if(idx>-1) q.splice(idx,1);
    });
    // ถ้าออกระหว่างเกม -> ยุติห้อง
    for(const [rid,R] of rooms){
      if(R.p1.id===socket.id || R.p2.id===socket.id){
        io.to(rid).emit("game:end",{ win:false });
        rooms.delete(rid);
      }
    }
  });
});
