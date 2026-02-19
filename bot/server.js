require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

// --- CONFIG ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const GAME_URL = process.env.GAME_URL || `http://localhost:${PORT}`;

if (!BOT_TOKEN) {
    console.error("ERROR: BOT_TOKEN is not defined in .env file");
    process.exit(1);
}

// --- EXPRESS + SOCKET.IO ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(express.json());
app.use(cors());

// Serve the game client
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, wins INTEGER DEFAULT 0)");
});
db.on('error', (err) => console.error('DB error (non-fatal):', err.message));

// --- TELEGRAM BOT ---
const bot = new Telegraf(BOT_TOKEN);

// Lobby state
const lobbies = new Map(); // chatId -> { players: [], active: boolean }

bot.command('challenge', (ctx) => {
    const chatId = ctx.chat.id;
    if (lobbies.has(chatId) && lobbies.get(chatId).active) {
        return ctx.reply('Уже идет набор в игру! Пиши /join.');
    }
    lobbies.set(chatId, { players: [], active: true, creator: ctx.from.id });
    ctx.reply(
        '🚀 ВЫЗОВ БРОШЕН!\n\n' +
        'Кто готов к битве? Пишите /join (макс 8 чел).\n' +
        'Когда все собрались — пишите /go чтобы начать!\n' +
        'Отменить набор — /cancel'
    );
});

bot.command('join', (ctx) => {
    const chatId = ctx.chat.id;
    const user = ctx.from;
    const lobby = lobbies.get(chatId);

    if (!lobby || !lobby.active) {
        return ctx.reply('Нет активного набора. Начни его командой /challenge.');
    }
    if (lobby.players.find(p => p.id === user.id)) {
        return ctx.reply('Ты уже в деле!');
    }
    if (lobby.players.length >= 8) {
        return ctx.reply('Мест нет! Все 8 игроков набраны.');
    }

    lobby.players.push({ id: user.id, name: user.username || user.first_name });
    const playerList = lobby.players.map((p, i) => `  ${i + 1}. ${p.name}`).join('\n');
    let msg = `✅ ${user.first_name} присоединился! (${lobby.players.length}/8)\n\n👥 Игроки:\n${playerList}`;

    if (lobby.players.length === 8) {
        const gameLink = `${GAME_URL}/game.html?room=${chatId}`;
        msg += `\n\n🎯 ОТРЯД СОБРАН! Нажми кнопку ниже!`;
        lobby.active = false;
        ctx.reply(msg, {
            reply_markup: { inline_keyboard: [[{ text: '🎮 В БОЙ!', web_app: { url: gameLink } }]] }
        });
    } else {
        msg += `\n\n💡 Готовы начать? Пишите /go`;
        ctx.reply(msg);
    }
});

bot.command('go', (ctx) => {
    const chatId = ctx.chat.id;
    const lobby = lobbies.get(chatId);
    if (!lobby || !lobby.active) {
        return ctx.reply('Нет активного набора. Начни командой /challenge.');
    }
    if (lobby.players.length === 0) {
        return ctx.reply('Пока никто не присоединился! Сначала напишите /join.');
    }
    const gameLink = `${GAME_URL}/game.html?room=${chatId}`;
    const playerList = lobby.players.map((p, i) => `  ${i + 1}. ${p.name}`).join('\n');
    lobby.active = false;
    ctx.reply(
        `🎯 НАЧИНАЕМ С ${lobby.players.length} ИГРОКАМИ!\n\n` +
        `👥 Состав:\n${playerList}`,
        { reply_markup: { inline_keyboard: [[{ text: '🎮 В БОЙ!', web_app: { url: gameLink } }]] } }
    );
});

bot.command('cancel', (ctx) => {
    const chatId = ctx.chat.id;
    const lobby = lobbies.get(chatId);
    if (!lobby || !lobby.active) return ctx.reply('Нет активного набора.');
    lobby.active = false;
    lobbies.delete(chatId);
    ctx.reply('❌ Набор отменён.');
});

bot.command('stats', (ctx) => {
    db.all("SELECT username, wins FROM users ORDER BY wins DESC LIMIT 10", (err, rows) => {
        if (err) return ctx.reply('Ошибка БД.');
        if (!rows || rows.length === 0) return ctx.reply('Пока нет статистики.');
        let msg = '🏆 ТОП ИГРОКОВ:\n';
        rows.forEach((row, idx) => {
            msg += `${idx + 1}. ${row.username} — ${row.wins} побед\n`;
        });
        ctx.reply(msg);
    });
});

// --- WIN REPORTING API ---
app.post('/api/report-win', (req, res) => {
    const { chatId, winnerName, winnerId } = req.body;
    try {
        db.run(
            "INSERT INTO users (id, username, wins) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET wins = wins + 1, username = excluded.username",
            [String(winnerId), String(winnerName)],
            (err) => { if (err) console.error('DB write error:', err.message); }
        );
    } catch (e) { console.error('DB exception:', e.message); }
    if (chatId) {
        bot.telegram.sendMessage(chatId, `🎉 ПОБЕДА! ${winnerName} оказался последним выжившим! Статистика обновлена.`)
            .catch(e => console.error('TG send error:', e.message));
    }
    res.json({ success: true });
});

// ==============================================================
// GAME ROOMS (Socket.IO)
// ==============================================================
const gameRooms = new Map(); // roomId -> Map(socketId -> playerData)

io.on('connection', (socket) => {
    let currentRoom = null;
    let playerName = 'Player';

    socket.on('joinRoom', (data) => {
        const roomId = data.room || 'default';
        playerName = data.name || 'Player';
        currentRoom = roomId;

        socket.join(roomId);

        if (!gameRooms.has(roomId)) {
            gameRooms.set(roomId, new Map());
        }

        const room = gameRooms.get(roomId);
        room.set(socket.id, {
            id: socket.id,
            name: playerName,
            x: 0, y: 0, rot: 0,
            hp: 100
        });

        // Tell the new player about everyone already in the room
        const existingPlayers = [];
        room.forEach((p, id) => {
            if (id !== socket.id) {
                existingPlayers.push(p);
            }
        });
        socket.emit('currentPlayers', existingPlayers);

        // Tell everyone else about the new player
        socket.to(roomId).emit('playerJoined', {
            id: socket.id,
            name: playerName
        });

        // Update player count for all
        io.to(roomId).emit('playerCount', room.size);

        console.log(`[${roomId}] ${playerName} joined (${room.size} players)`);
    });

    // Player position update (sent ~20 times/sec)
    socket.on('pos', (data) => {
        if (!currentRoom) return;
        const room = gameRooms.get(currentRoom);
        if (!room) return;

        const player = room.get(socket.id);
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.rot = data.rot;
            player.hp = data.hp;
        }

        // Broadcast to others in the room
        socket.to(currentRoom).emit('playerMoved', {
            id: socket.id,
            x: data.x,
            y: data.y,
            rot: data.rot,
            hp: data.hp
        });
    });

    // Player shot
    socket.on('shoot', (data) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('playerShot', {
            id: socket.id,
            x: data.x,
            y: data.y,
            angle: data.angle,
            weapon: data.weapon
        });
    });

    // Player hit another player
    socket.on('hit', (data) => {
        if (!currentRoom) return;
        // Forward hit info to the specific target player
        io.to(data.targetId).emit('youWereHit', {
            attackerId: socket.id,
            damage: data.damage
        });
    });

    // Player died
    socket.on('died', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('playerDied', { id: socket.id });
    });

    // Disconnect
    socket.on('disconnect', () => {
        if (currentRoom && gameRooms.has(currentRoom)) {
            const room = gameRooms.get(currentRoom);
            room.delete(socket.id);

            socket.to(currentRoom).emit('playerLeft', { id: socket.id });
            io.to(currentRoom).emit('playerCount', room.size);

            console.log(`[${currentRoom}] ${playerName} left (${room.size} players)`);

            // Clean up empty rooms
            if (room.size === 0) {
                gameRooms.delete(currentRoom);
            }
        }
    });
});

// --- LAUNCH ---
bot.launch();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Game Dream server running on port ${PORT}`);
    console.log(`Game URL: ${GAME_URL}`);
});
