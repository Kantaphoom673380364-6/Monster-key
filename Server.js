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

// ======== ✅ เสิร์ฟไฟล์ทั้งหมด ========
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Routes
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
const roomReady = {};

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  // ===== 🔍 จับคู่ผู้เล่น =====
  socket.on("findMatch", ({ playerName, difficulty }) => {
    const lane = difficulty === "hard" ? "hard" : "easy";

    // ป้องกันการจับคู่ตัวเองซ้ำ
    if (waiting[lane]?.id === socket.id) {
      socket.emit("waiting", "คุณกำลังรอผู้เล่นอีกคนอยู่...");
      return;
    }

    if (!waiting[lane]) {
      // ยังไม่มีใครรอ → เก็บไว้ในคิว
      waiting[lane] = { id: socket.id, name: playerName };
      socket.emit("waiting", "กำลังรอผู้เล่นอีกคน...");
      console.log(`⏳ ${playerName} รอในแถว ${lane}`);
    } else {
      // มีคนรออยู่ → จับคู่สำเร็จ
      const roomId = `room_${lane}_${Date.now()}`;
      const mate = waiting[lane];
      waiting[lane] = null;

      // เข้าร่วมห้อง
      socket.join(roomId);
      const mateSocket = io.sockets.sockets.get(mate.id);
      if (mateSocket) mateSocket.join(roomId);

      // บันทึกข้อมูลผู้เล่น
      activePlayers[socket.id] = { roomId, partnerId: mate.id, name: playerName };
      activePlayers[mate.id] = { roomId, partnerId: socket.id, name: mate.name };

      // แจ้งผลการจับคู่
      io.to(socket.id).emit("matchFound", {
        roomId,
        partner: mate.name,
        yourId: socket.id,
        partnerId: mate.id,
        isLeft: false  // คนที่เข้าใหม่อยู่ขวา
      });

      io.to(mate.id).emit("matchFound", {
        roomId,
        partner: playerName,
        yourId: mate.id,
        partnerId: socket.id,
        isLeft: true   // คนที่รออยู่ก่อนอยู่ซ้าย
      });

      console.log(`🎮 จับคู่สำเร็จ: ${mate.name} ❤️ ${playerName} [${lane}] → Room: ${roomId}`);
    }
  });

  // ===== ⚔️ โจมตีบอส =====
  socket.on("attackBoss", ({ roomId, damage }) => {
    console.log(`⚔️ ${socket.id} attacked boss in ${roomId} with ${damage} damage`);
    
    // แจ้งให้ทุกคนในห้องเห็นการโจมตี
    io.to(roomId).emit("playerAttack", { attackerId: socket.id });
    io.to(roomId).emit("bossAttacked", damage);
  });

  // ===== 💔 ผู้เล่นโดนโจมตี =====
  socket.on("playerDamaged", ({ roomId, player }) => {
    console.log(`💔 Player ${player} damaged in ${roomId}`);
    socket.broadcast.to(roomId).emit("syncPlayerHealth", {
      damagedPlayerId: socket.id,
      player
    });
  });

  // ===== 🩸 Animation โดนตี =====
  socket.on("playerHitAnimation", ({ roomId, player }) => {
    socket.broadcast.to(roomId).emit("playHitAnimation", {
      damagedPlayerId: socket.id,
      player
    });
  });

  // ===== 🔥 Sync Buff =====
  socket.on("syncBuff", (payload) => {
    const { roomId } = payload;
    console.log(`🔥 Buff synced in ${roomId}`);
    socket.broadcast.to(roomId).emit("buffSync", payload);
  });

  // ===== 💀 ทีมแพ้ =====
  socket.on("teamDefeated", ({ roomId }) => {
    console.log(`💀 Team defeated in ${roomId}`);
    io.to(roomId).emit("teamDefeated");
  });

  // ===== ✅ ผู้เล่นพร้อม =====
  socket.on("playerReady", ({ roomId, playerId }) => {
    if (!roomReady[roomId]) roomReady[roomId] = new Set();
    roomReady[roomId].add(playerId);

    console.log(`✅ Player ${playerId} ready in ${roomId} (${roomReady[roomId].size}/2)`);

    // ถ้ามีครบสองคน
    if (roomReady[roomId].size >= 2) {
      io.to(roomId).emit("startGame", { roomId });
      delete roomReady[roomId];
      console.log(`🎮 Game started in ${roomId}`);
    }
  });

  // ===== 🚪 ออกจากเกม =====
  socket.on("leaveGame", ({ playerId, partnerId }) => {
    console.log(`🚪 ${playerId} left the game`);
    
    // บังคับให้คู่หูออกจากเกม
    io.to(partnerId).emit("forceEndGame");
    
    // ลบข้อมูลผู้เล่น
    if (activePlayers[playerId]) {
      const roomId = activePlayers[playerId].roomId;
      console.log(`🗑️ Cleaning up room ${roomId}`);
      delete activePlayers[playerId];
    }
    if (activePlayers[partnerId]) {
      delete activePlayers[partnerId];
    }
  });

  // ===== ⚠️ กำลังจะ Disconnect =====
  socket.on("disconnecting", () => {
    const playerInfo = activePlayers[socket.id];
    if (playerInfo) {
      console.log(`⚠️ ${socket.id} is disconnecting from room ${playerInfo.roomId}`);
      io.to(playerInfo.partnerId).emit("forceEndGame");
    }
  });

  // ===== ❌ Disconnect =====
  socket.on("disconnect", () => {
    console.log(`❌ ${socket.id} disconnected`);
    
    const playerInfo = activePlayers[socket.id];
    
    if (playerInfo) {
      const partnerSocket = io.sockets.sockets.get(playerInfo.partnerId);
      if (partnerSocket && partnerSocket.connected) {
        console.log(`📢 Notifying partner ${playerInfo.partnerId} about disconnect`);
        io.to(playerInfo.partnerId).emit("forceEndGame");
      }
      
      delete activePlayers[socket.id];
      delete activePlayers[playerInfo.partnerId];
    }
    
    // ลบจากคิวรอ
    if (waiting.easy?.id === socket.id) {
      console.log(`🗑️ Removed ${socket.id} from easy queue`);
      waiting.easy = null;
    }
    if (waiting.hard?.id === socket.id) {
      console.log(`🗑️ Removed ${socket.id} from hard queue`);
      waiting.hard = null;
    }
  });
});

// ======== ✅ Start Server ========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🎮 Game is ready to play!`);
  console.log(`📂 Make sure your files are in the 'public' folder`);
});