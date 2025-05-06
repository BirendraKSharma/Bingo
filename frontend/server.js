// ==== server.js (Node.js backend with Socket.IO) ====
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let rooms = {}; // Keeps track of room members

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) rooms[roomId] = [];
        if (!rooms[roomId].includes(socket.id)) {
            rooms[roomId].push(socket.id);
        }
        io.to(roomId).emit("player-joined", rooms[roomId]);
    });

    socket.on("cell-clicked", ({ roomId, cellValue }) => {
        socket.to(roomId).emit("opponent-clicked", cellValue);
    });

    socket.on("reset-game", (roomId) => {
        io.to(roomId).emit("new-game");
    });

    socket.on("disconnect", () => {
        for (const roomId in rooms) {
            rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
            io.to(roomId).emit("player-joined", rooms[roomId]);
        }
        console.log("User disconnected:", socket.id);
    });
});

server.listen(3001, () => {
    console.log("Server running on http://localhost:3001");
});
