// ======== ✅ Import Modules ========
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// ======== ✅ สร้าง Server ========
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ======== ✅ ให้ Express เสิร์ฟไฟล์ Static ========
app.use(express.static(path.join(__dirname))); // เสิร์ฟไฟล์ทุกอย่างในโฟลเดอร์เดียวกับ Server.js

// ======== ✅ Route หลัก (index.html) ========
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// ======== ✅ Socket.IO สำหรับ Co-op Mode ========
let players = {};
let rooms = {};

io.on("connection", (socket) => {
  console.log(`🟢 Client connected: ${socket.id}`);

  socket.on("joinRoom", ({ roomId, playerName, difficulty }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = { players: {}, difficulty: difficulty };
    }

    rooms[roomId].players[socket.id] = playerName;
    console.log(`👥 Player ${playerName} joined room ${roomId}`);

    // อัปเดตสถานะให้ผู้เล่นในห้อง
    io.to(roomId).emit("updatePlayers", Object.values(rooms[roomId].players));
  });

  socket.on("attackBoss", ({ roomId, damage }) => {
    io.to(roomId).emit("bossAttacked", damage);
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        console.log(`🔴 ${room.players[socket.id]} disconnected`);
        delete room.players[socket.id];
        io.to(roomId).emit("updatePlayers", Object.values(room.players));

        if (Object.keys(room.players).length === 0) {
          delete rooms[roomId];
          console.log(`🗑️ Room ${roomId} deleted`);
        }
        break;
      }
    }
  });
});

// ======== ✅ Port สำหรับ Render ========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
