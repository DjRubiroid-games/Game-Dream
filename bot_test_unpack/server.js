require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

// --- CONFIG ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const GAME_URL = process.env.GAME_URL || 'https://YOUR_GITHUB_PAGES_URL.io/';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    console.error("ERROR: BOT_TOKEN is not defined in .env file");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, wins INTEGER DEFAULT 0)");
});

// --- LOBBY STATE ---
const lobbies = new Map(); // chatId -> { players: [], active: boolean }

// --- BOT COMMANDS ---
bot.command('challenge', (ctx) => {
    const chatId = ctx.chat.id;
    if (lobbies.has(chatId) && lobbies.get(chatId).active) {
        return ctx.reply('Уже идет набор в игру! Пиши /join.');
    }

    lobbies.set(chatId, { players: [], active: true });
    ctx.reply('🚀 ВЫЗОВ БРОШЕН! Кто готов к битве? Пишите /join (макс 8 чел).');
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

    let msg = `✅ ${user.first_name} присоединился! (${lobby.players.length}/8)`;
    if (lobby.players.length === 8) {
        const gameLink = `${GAME_URL}?chatId=${chatId}`;
        msg += `\n\n🎯 ОТРЯД СОБРАН! Все в бой:\n${gameLink}`;
        lobby.active = false;
    }
    ctx.reply(msg);
});

bot.command('stats', (ctx) => {
    db.all("SELECT username, wins FROM users ORDER BY wins DESC LIMIT 10", (err, rows) => {
        if (err) return ctx.reply('Ошибка БД.');
        let msg = '🏆 ТОП ИГРОКОВ:\n';
        rows.forEach((row, idx) => {
            msg += `${idx + 1}. ${row.username} — ${row.wins} побед\n`;
        });
        ctx.reply(msg);
    });
});

// --- WIN REPORTING API ---
app.post('/api/report-win', (ctx_req, res) => {
    const { chatId, winnerName, winnerId } = ctx_req.body;

    // Update stats
    db.run("INSERT INTO users (id, username, wins) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET wins = wins + 1, username = excluded.username",
        [winnerId, winnerName]);

    // Announce in TG
    bot.telegram.sendMessage(chatId, `🎉 ПОБЕДА! ${winnerName} оказался последним выжившим! Статистика обновлена.`);

    res.json({ success: true });
});

// Launch
bot.launch();
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
