// ======== ✅ Import Modules ========
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// ======== ✅ สร้าง Server ========
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// เสิร์ฟไฟล์ทั้งหมด (รวมถึง coop.html, solo.html, index.html)
// ======== ✅ เสิร์ฟไฟล์ทั้งหมด (รวมถึง coop, solo, index) ========
app.use(express.static(path.join(__dirname, 'public')));

// ✅ route สำหรับหน้า index/solo/coop
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/solo.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'solo.html'));
});
app.get('/coop.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'coop.html'));
});








// =============================
// 🎮 ระบบจับคู่ผู้เล่น Co-op
// =============================
const waiting = { easy: null, hard: null };
const activePlayers = {};

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);
  // --- ✅ จับคู่ผู้เล่น ---
  socket.on("findMatch", ({ playerName, difficulty }) => {
    const lane = difficulty === "hard" ? "hard" : "easy";

     if (waiting[lane]?.id === socket.id) {
    socket.emit("waiting", "คุณกำลังรอผู้เล่นอีกคนอยู่...");
    return;
  }

    if (!waiting[lane]) {
      // ถ้ายังไม่มีใครรอ → เก็บไว้
      waiting[lane] = { id: socket.id, name: playerName };
      socket.emit("waiting", "กำลังรอผู้เล่นอีกคน...");
      console.log(`⏳ ${playerName} รอในแถว ${lane}`);
    } else {
      // มีคนรอ → จับคู่สำเร็จ
      const roomId = `room_${lane}_${Date.now()}`;
      const mate = waiting[lane];
      waiting[lane] = null;

      socket.join(roomId);
      io.sockets.sockets.get(mate.id)?.join(roomId);

      activePlayers[socket.id] = { roomId, partnerId: mate.id };
      activePlayers[mate.id] = { roomId, partnerId: socket.id };

      // แจ้งทั้งสองฝั่ง
     io.to(socket.id).emit("matchFound", { 
  roomId, 
  partner: mate.name,
  yourId: socket.id,
  partnerId: mate.id,
  isLeft: true      // ฝั่งที่เข้าใหม่อยู่ซ้าย
});
io.to(mate.id).emit("matchFound", { 
  roomId, 
  partner: playerName,
  yourId: mate.id,
  partnerId: socket.id,
  isLeft: false     // ฝั่งที่รอก่อนอยู่ขวา
});


      console.log(`🎮 จับคู่สำเร็จ: ${playerName} ❤️ ${mate.name} [${lane}]`);
    }
  });

  // --- ✅ ดาเมจจากผู้เล่น ---
  socket.on("attackBoss", ({ roomId, damage }) => {
  // ส่งให้ทุกคนในห้องเห็นทั้งท่าตีและเลือดลดพร้อมกัน
  io.to(roomId).emit("playerAttack", { attackerId: socket.id });
  io.to(roomId).emit("bossAttacked", damage);
});
// ...
socket.on("playerDamaged", ({ roomId, player }) => {
  // player จะเป็น "p1" หรือ "p2"
  socket.broadcast.to(roomId).emit("syncPlayerHealth", { damagedPlayerId: socket.id, player });
});


socket.on("playerHitAnimation", ({ roomId, player }) => {
  io.to(roomId).emit("playHitAnimation", { damagedPlayerId: socket.id, player });
});

io.on("connection", (socket) => {
  console.log("✅ New player connected:", socket.id);

  // ✅ event syncBuff ต้องอยู่ "ภายใน" connection เท่านั้น
  socket.on("syncBuff", (payload) => {
    const { roomId, buffData } = payload;
    io.to(roomId).emit("syncBuff", buffData);
  });
  socket.on("leaveGame", ({ playerId, partnerId }) => {
  console.log(`🏃 ผู้เล่น ${playerId} กดออกจากเกม`);
  io.to(partnerId).emit("forceEndGame"); // บังคับให้คู่หูจบเกมทันที
  if (activePlayers[playerId]) delete activePlayers[playerId];
  if (activePlayers[partnerId]) delete activePlayers[partnerId];
});

socket.on("disconnecting", () => {
  const playerInfo = activePlayers[socket.id];
  if (playerInfo) {
    console.log(`⚠️ ${socket.id} กำลังจะหลุดจากห้อง ${playerInfo.roomId}`);
    io.to(playerInfo.partnerId).emit("forceEndGame");
  }
});

socket.on("disconnect", () => {
  console.log(`❌ ${socket.id} disconnected`);
  const playerInfo = activePlayers[socket.id];
  if (playerInfo) {
    const partnerSocket = io.sockets.sockets.get(playerInfo.partnerId);
    if (partnerSocket && partnerSocket.connected) {
      io.to(playerInfo.partnerId).emit("forceEndGame");
    }
    delete activePlayers[socket.id];
    delete activePlayers[playerInfo.partnerId];
  }
  if (waiting.easy?.id === socket.id) waiting.easy = null;
  if (waiting.hard?.id === socket.id) waiting.hard = null;
});
// ✅ ตรวจว่าในห้องมี 2 คนพร้อมแล้วค่อยเริ่ม
const roomReady = {};

socket.on("playerReady", ({ roomId, playerId }) => {
  if (!roomReady[roomId]) roomReady[roomId] = new Set();
  roomReady[roomId].add(playerId);

  // ถ้ามีครบสองคน
  if (roomReady[roomId].size >= 2) {
    io.to(roomId).emit("startGame", { roomId });
    delete roomReady[roomId];
  }
});
socket.on("teamDefeated", ({ roomId }) => {
  // แจ้งทุกคนในห้องว่าแพ้ร่วมกัน
  io.to(roomId).emit("teamDefeated");
});


  // ... event อื่น ๆ ที่เกี่ยวกับห้องหรือโจมตี ฯลฯ
});



  });

  // --- ✅ Sync Buff ระหว่างผู้เล่น ---
  
 




// ======== ✅ Port สำหรับ Render / Local ========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
