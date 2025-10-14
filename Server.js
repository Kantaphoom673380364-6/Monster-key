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
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =============================
// 🎮 ระบบจับคู่ผู้เล่น Co-op
// =============================
const waiting = { easy: null, hard: null };

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  // --- ✅ จับคู่ผู้เล่น ---
  socket.on("findMatch", ({ playerName, difficulty }) => {
    const lane = difficulty === "hard" ? "hard" : "easy";

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

      // แจ้งทั้งสองฝั่ง
      io.to(socket.id).emit("matchFound", { roomId, partner: mate.name });
      io.to(mate.id).emit("matchFound", { roomId, partner: playerName });

      console.log(`🎮 จับคู่สำเร็จ: ${playerName} ❤️ ${mate.name} [${lane}]`);
    }
  });

  // --- ✅ ดาเมจจากผู้เล่น ---
  socket.on("attackBoss", ({ roomId, damage }) => {
    io.to(roomId).emit("bossAttacked", damage);
  });

  // --- ✅ Sync Buff ระหว่างผู้เล่น ---
  socket.on("syncBuff", (payload) => {
    // payload = { roomId, who, active, until }
    io.to(payload.roomId).emit("buffSync", payload);
  });

  // --- 🔴 ตัดการเชื่อมต่อ ---
  socket.on("disconnect", () => {
    console.log(`❌ ${socket.id} disconnected`);

    // ถ้าเป็นคนที่รออยู่ให้เคลียร์ออก
    if (waiting.easy?.id === socket.id) waiting.easy = null;
    if (waiting.hard?.id === socket.id) waiting.hard = null;
  });
});

// ======== ✅ Port สำหรับ Render / Local ========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
