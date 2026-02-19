// ============================================================
// GAME DREAM - Battle Royale (Phaser 3 + Socket.IO)
// Desktop + Mobile Touch Controls
// ============================================================

// --- CONFIG ---
const CFG = {
    MAP: 3000,
    TILE: 40,
    PLAYER_SPEED: 220,
    PLAYER_HP: 100,
    BULLET_SPEED: 700,
    BULLET_DAMAGE: 20,
    STORM_DAMAGE: 1,
    STORM_TICK: 500,
    STORM_PHASES: [
        { delay: 60000, targetFraction: 0.45, speed: 0.08, damageMult: 1 },
        { delay: 30000, targetFraction: 0.25, speed: 0.12, damageMult: 2 },
        { delay: 45000, targetFraction: 0.13, speed: 0.10, damageMult: 3 },
    ],
    LOOT_COUNT: 80,
    TREE_COUNT: 150,
    ROCK_COUNT: 60,
    BUILDING_COUNT: 20,
    NET_SYNC_RATE: 50,
    JOYSTICK_RADIUS: 50,   // max drag distance from center
    GRID_SIZE: 160,  // grid cell size in pixels
    COLORS: {
        GRASS: 0x6B8E4E,       // bright olive green
        GRID_LINE: 0x5A7A42,   // subtle darker grid lines
        TREE_FILL: 0x3E6B2B,   // tree canopy
        TREE_DARK: 0x2D5120,   // tree shadow
        TREE_OUTLINE: 0x1A3312, // dark outline
        ROCK: 0x8E8E8E,
        ROCK_LIGHT: 0xAAAAAA,
        ROCK_OUTLINE: 0x5A5A5A,
        BUILDING: 0xc8b89a,
        ROOF: 0x8b6f47,
    }
};

// --- WEAPONS ---
const WEAPONS = {
    pistol: { name: 'Пистолет', damage: 20, ammo: 7, maxAmmo: 30, fireRate: 400, bulletSpeed: 700, range: 500 },
    shotgun: { name: 'Дробовик', damage: 40, ammo: 2, maxAmmo: 16, fireRate: 900, bulletSpeed: 600, range: 300 },
    rifle: { name: 'Автомат', damage: 15, ammo: 30, maxAmmo: 90, fireRate: 120, bulletSpeed: 900, range: 700 },
    sniper: { name: 'Снайперка', damage: 80, ammo: 5, maxAmmo: 20, fireRate: 1500, bulletSpeed: 1200, range: 1200 },
};

// --- GLOBAL STATE ---
let myHp = CFG.PLAYER_HP;
let myArmor = 0;
let myWeapon = { ...WEAPONS.pistol, currentAmmo: WEAPONS.pistol.ammo };
let lastFired = 0;
let isGameOver = false;
let stormRadius, stormCenterX, stormCenterY;
let stormPhase = 0, stormState = 'waiting', stormTimer = 0;
let stormTargetRadius = 0, stormCurrentDamageMult = 1;
let lastSyncTime = 0;
let isReloading = false;

// --- MOBILE DETECTION ---
const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
window.onerror = (m, u, l) => alert(`JS Error: ${m} at line ${l}`);

// --- TOUCH STATE ---
const touchMove = { active: false, id: null, startX: 0, startY: 0, dx: 0, dy: 0 };
const touchAim = { active: false, id: null, startX: 0, startY: 0, dx: 0, dy: 0, angle: 0 };

// --- NETWORKING ---
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || 'public';

// Get player name: Telegram WebApp → URL param → random
function getTelegramName() {
    try {
        const tg = window.Telegram && window.Telegram.WebApp;
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const u = tg.initDataUnsafe.user;
            let name = u.first_name || '';
            if (u.last_name) name += ' ' + u.last_name.charAt(0) + '.';
            return name.trim() || null;
        }
    } catch (e) { }
    return null;
}
const playerName = getTelegramName() || urlParams.get('name') || 'Игрок_' + Math.floor(Math.random() * 999);
const socket = io();
const netPlayers = new Map();

// ============================================================
// TOUCH CONTROLS (DOM level — outside Phaser)
// ============================================================
function initTouchControls() {
    if (!isMobile) return;

    // Show touch elements
    document.getElementById('touch-move-zone').style.display = 'block';
    document.getElementById('touch-aim-zone').style.display = 'block';
    document.getElementById('btn-reload').style.display = 'block';

    const moveZone = document.getElementById('touch-move-zone');
    const aimZone = document.getElementById('touch-aim-zone');

    const moveBase = document.getElementById('move-base');
    const moveKnob = document.getElementById('move-knob');
    const aimBase = document.getElementById('aim-base');
    const aimKnob = document.getElementById('aim-knob');

    const R = CFG.JOYSTICK_RADIUS;

    // --- MOVE JOYSTICK (left half) ---
    moveZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        touchMove.active = true;
        touchMove.id = t.identifier;
        touchMove.startX = t.clientX;
        touchMove.startY = t.clientY;
        touchMove.dx = 0;
        touchMove.dy = 0;

        moveBase.style.display = 'block';
        moveKnob.style.display = 'block';
        moveBase.style.left = t.clientX + 'px';
        moveBase.style.top = t.clientY + 'px';
        moveKnob.style.left = t.clientX + 'px';
        moveKnob.style.top = t.clientY + 'px';
    }, { passive: false });

    moveZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier !== touchMove.id) continue;
            let dx = t.clientX - touchMove.startX;
            let dy = t.clientY - touchMove.startY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // Clamp to radius
            if (dist > R) { dx = dx / dist * R; dy = dy / dist * R; }
            touchMove.dx = dx;
            touchMove.dy = dy;

            moveKnob.style.left = (touchMove.startX + dx) + 'px';
            moveKnob.style.top = (touchMove.startY + dy) + 'px';
        }
    }, { passive: false });

    const endMove = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== touchMove.id) continue;
            touchMove.active = false;
            touchMove.dx = 0;
            touchMove.dy = 0;
            moveBase.style.display = 'none';
            moveKnob.style.display = 'none';
        }
    };
    moveZone.addEventListener('touchend', endMove, { passive: false });
    moveZone.addEventListener('touchcancel', endMove, { passive: false });

    // --- AIM JOYSTICK (right half) ---
    aimZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        touchAim.active = true;
        touchAim.id = t.identifier;
        touchAim.startX = t.clientX;
        touchAim.startY = t.clientY;
        touchAim.dx = 0;
        touchAim.dy = 0;

        aimBase.style.display = 'block';
        aimKnob.style.display = 'block';
        aimBase.style.left = t.clientX + 'px';
        aimBase.style.top = t.clientY + 'px';
        aimKnob.style.left = t.clientX + 'px';
        aimKnob.style.top = t.clientY + 'px';
    }, { passive: false });

    aimZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier !== touchAim.id) continue;
            let dx = t.clientX - touchAim.startX;
            let dy = t.clientY - touchAim.startY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > R) { dx = dx / dist * R; dy = dy / dist * R; }
            touchAim.dx = dx;
            touchAim.dy = dy;
            touchAim.angle = Math.atan2(dy, dx);

            aimKnob.style.left = (touchAim.startX + dx) + 'px';
            aimKnob.style.top = (touchAim.startY + dy) + 'px';
        }
    }, { passive: false });

    const endAim = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== touchAim.id) continue;
            touchAim.active = false;
            touchAim.dx = 0;
            touchAim.dy = 0;
            aimBase.style.display = 'none';
            aimKnob.style.display = 'none';
        }
    };
    aimZone.addEventListener('touchend', endAim, { passive: false });
    aimZone.addEventListener('touchcancel', endAim, { passive: false });
}

// ============================================================
// PHASER SCENE
// ============================================================
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    preload() {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        // Body (blue) - just the circle now
        g.fillStyle(0x3498db, 1); g.fillCircle(16, 16, 14);
        g.lineStyle(2, 0x21618c, 1); g.strokeCircle(16, 16, 14);
        g.generateTexture('player_body_blue', 32, 32); g.clear();
        // Body (red)
        g.fillStyle(0xe74c3c, 1); g.fillCircle(16, 16, 14);
        g.lineStyle(2, 0x943126, 1); g.strokeCircle(16, 16, 14);
        g.generateTexture('player_body_red', 32, 32); g.clear();
        // Gun sprite (simple rect)
        g.fillStyle(0x333333, 1); g.fillRect(0, 0, 15, 6);
        g.lineStyle(1, 0x000000, 1); g.strokeRect(0, 0, 15, 6);
        g.generateTexture('gun_pistol', 16, 8); g.clear();
        // Bullet
        g.fillStyle(0xffff00, 1); g.fillCircle(4, 4, 4);
        g.generateTexture('bullet', 8, 8); g.clear();

        // Roof (Green Shingles)
        g.fillStyle(0x3E6B2B, 1); g.fillRect(0, 0, 64, 64);
        g.lineStyle(2, 0x2D5120, 1);
        for (let x = 0; x <= 64; x += 16) { g.moveTo(x, 0); g.lineTo(x, 64); }
        for (let y = 0; y <= 64; y += 16) {
            let offset = (y % 32 === 0) ? 0 : 8;
            g.moveTo(0, y); g.lineTo(64, y);
        }
        g.strokePath();
        g.generateTexture('tex_roof', 64, 64); g.clear();

        // Floor texture (wooden)
        g.fillStyle(0x875a3c, 1); g.fillRect(0, 0, 64, 64);
        g.lineStyle(1, 0x5d4037, 1);
        for (let i = 0; i < 64; i += 16) { g.moveTo(0, i); g.lineTo(64, i); }
        g.strokePath();
        g.generateTexture('tex_floor', 64, 64); g.clear();

        // Stone path
        g.fillStyle(0x999999, 1); g.fillRect(0, 0, 32, 32);
        g.lineStyle(1, 0x666666, 1);
        for (let i = 0; i < 32; i += 8) { g.moveTo(i, 0); g.lineTo(i, 32); g.moveTo(0, i); g.lineTo(32, i); }
        g.strokePath();
        g.generateTexture('tex_stone', 32, 32); g.clear();
        // Bush
        g.fillStyle(0x2d5a27, 1); g.fillCircle(20, 20, 18);
        g.lineStyle(2, 0x1a3312, 1); g.strokeCircle(20, 20, 18);
        g.generateTexture('bush', 40, 40); g.clear();

        // Crosshair
        g.lineStyle(2, 0xffffff, 1);
        g.strokeCircle(16, 16, 10);
        g.moveTo(16, 2); g.lineTo(16, 10);
        g.moveTo(16, 22); g.lineTo(16, 30);
        g.moveTo(2, 16); g.lineTo(10, 16);
        g.moveTo(22, 16); g.lineTo(30, 16);
        g.strokePath();
        g.generateTexture('crosshair', 32, 32); g.clear();

        g.destroy();

        // SVG loot icons
        this.load.svg('loot_pistol', 'assets/pistol.svg', { width: 32, height: 32 });
        this.load.svg('loot_shotgun', 'assets/shotgun.svg', { width: 40, height: 32 });
        this.load.svg('loot_rifle', 'assets/rifle.svg', { width: 44, height: 32 });
        this.load.svg('loot_sniper', 'assets/sniper.svg', { width: 48, height: 32 });
        this.load.svg('loot_medkit', 'assets/medkit.svg', { width: 32, height: 32 });
        this.load.svg('loot_armor', 'assets/armor.svg', { width: 32, height: 32 });
        this.load.svg('loot_ammo', 'assets/ammo.svg', { width: 32, height: 32 });
    }

    create() {
        const W = CFG.MAP, H = CFG.MAP;
        this.physics.world.setBounds(0, 0, W, H);

        this.drawGround();
        this.obstacles = this.physics.add.staticGroup();
        this.buildings = [];
        this.bushes = this.physics.add.staticGroup(); // Initialize bushes group here
        this.generateMap();

        // Storm
        this.stormGraphics = this.add.graphics();
        this.stormGraphics.setDepth(50);
        stormCenterX = W / 2; stormCenterY = H / 2;
        stormRadius = W * 0.7;
        stormPhase = 0; stormState = 'waiting';
        stormTimer = CFG.STORM_PHASES[0].delay;

        // Loot
        this.lootItems = this.physics.add.group();
        this.spawnLoot();

        // Bullets
        this.bullets = this.physics.add.group({ defaultKey: 'bullet' });
        this.enemyBullets = this.physics.add.group({ defaultKey: 'bullet' });

        // Player
        const spawnX = Phaser.Math.Between(200, W - 200);
        const spawnY = Phaser.Math.Between(200, H - 200);
        this.myPlayer = this.physics.add.sprite(spawnX, spawnY, 'player_body_blue');
        this.myPlayer.setDepth(10).setCircle(14).setCollideWorldBounds(true);

        this.myGun = this.add.sprite(spawnX, spawnY, 'gun_pistol').setOrigin(0, 0.5).setDepth(11);

        this.crosshair = this.add.sprite(spawnX, spawnY, 'crosshair').setDepth(100).setScrollFactor(1);
        if (!isMobile) {
            this.input.setDefaultCursor('none');
            this.game.canvas.style.cursor = 'none';
        }

        this.myNameLabel = this.add.text(spawnX, spawnY - 25, playerName, {
            fontSize: '11px', color: '#ffffff',
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(20);

        // Camera
        this.cameras.main.setBounds(0, 0, W, H);
        this.cameras.main.startFollow(this.myPlayer, true, 0.1, 0.1);
        this.cameras.main.setZoom(isMobile ? 1.0 : 1.2);

        // Input
        this.keys = this.input.keyboard.addKeys('W,A,S,D,R');
        this.input.on('pointerdown', (ptr) => {
            if (!isMobile) this.shoot(ptr);
        });

        // Mobile reload button listener
        if (isMobile) {
            const btn = document.getElementById('btn-reload');
            if (btn) btn.onclick = () => this.reloadWeapon();
        }
        window.addEventListener('blur', () => { this.myPlayer.body.setVelocity(0, 0); });

        // Collisions
        this.physics.add.collider(this.myPlayer, this.obstacles);
        this.physics.add.overlap(this.myPlayer, this.lootItems, this.pickupLoot, null, this);
        this.physics.add.overlap(this.bullets, this.obstacles, (bullet) => { bullet.destroy(); });
        this.physics.add.overlap(this.enemyBullets, this.myPlayer, (player, bullet) => {
            const dmg = bullet.getData('damage') || CFG.BULLET_DAMAGE;
            bullet.destroy();
            this.takeDamage(dmg);
        });

        // Storm damage timer
        this.time.addEvent({
            delay: CFG.STORM_TICK, loop: true,
            callback: this.applyStormDamage, callbackScope: this
        });

        // Networking
        this.initNetwork();

        // Init touch controls
        initTouchControls();

        console.log('Game Dream: Scene ready! Mobile:', isMobile);
    }

    // ==========================================================
    // NETWORKING
    // ==========================================================
    initNetwork() {
        socket.emit('joinRoom', { room: roomId, name: playerName });

        socket.on('currentPlayers', (players) => {
            players.forEach(p => this.addNetPlayer(p.id, p.name, p.x, p.y));
        });
        socket.on('playerJoined', (data) => {
            this.addNetPlayer(data.id, data.name);
            this.addKillFeedMsg(data.name + ' присоединился');
        });
        socket.on('playerMoved', (data) => {
            const p = netPlayers.get(data.id);
            if (p) {
                p.targetX = data.x; p.targetY = data.y;
                p.targetRot = data.rot; p.hp = data.hp;
            }
        });
        socket.on('playerShot', (data) => {
            this.spawnEnemyBullet(data.x, data.y, data.angle, data.weapon);
        });
        socket.on('youWereHit', (data) => { this.takeDamage(data.damage); });
        socket.on('playerDied', (data) => {
            const p = netPlayers.get(data.id);
            if (p) { p.sprite.setTint(0x333333); p.dead = true; this.addKillFeedMsg(p.name + ' выбыл'); }
        });
        socket.on('playerLeft', (data) => { this.removeNetPlayer(data.id); });
        socket.on('playerCount', (count) => {
            document.getElementById('player-count').textContent = '👥 ' + count + ' игрок' + (count === 1 ? '' : 'ов');
        });
    }

    addNetPlayer(id, name, x, y) {
        if (netPlayers.has(id)) return;
        const px = x || Phaser.Math.Between(200, CFG.MAP - 200);
        const py = y || Phaser.Math.Between(200, CFG.MAP - 200);
        const sprite = this.physics.add.sprite(px, py, 'player_body_red').setDepth(9);
        const gun = this.add.sprite(px, py, 'gun_pistol').setOrigin(0, 0.5).setDepth(9.5);

        const label = this.add.text(px, py - 25, name || 'Player', {
            fontSize: '11px', color: '#ffcccc', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(15);
        this.physics.add.overlap(this.bullets, sprite, (enemy, bullet) => {
            const dmg = bullet.getData('damage') || CFG.BULLET_DAMAGE;
            bullet.destroy();
            socket.emit('hit', { targetId: id, damage: dmg });
            this.showFloatingText(enemy.x, enemy.y, '-' + dmg, '#e74c3c');
        });
        netPlayers.set(id, {
            sprite, gun, label, name: name || 'Player',
            targetX: px, targetY: py, targetRot: 0, hp: 100, dead: false
        });
    }

    removeNetPlayer(id) {
        const p = netPlayers.get(id);
        if (p) { p.sprite.destroy(); p.gun.destroy(); p.label.destroy(); netPlayers.delete(id); }
    }

    addKillFeedMsg(text) {
        const feed = document.getElementById('killfeed');
        const div = document.createElement('div');
        div.className = 'kill-msg'; div.textContent = text;
        feed.prepend(div);
        setTimeout(() => div.remove(), 4000);
    }

    spawnEnemyBullet(x, y, angle, weaponName) {
        const weapon = WEAPONS[weaponName] || WEAPONS.pistol;
        const pellets = (weaponName === 'shotgun') ? 5 : 1;
        for (let i = 0; i < pellets; i++) {
            const spread = pellets > 1 ? Phaser.Math.DegToRad(Phaser.Math.Between(-15, 15)) : 0;
            const bullet = this.enemyBullets.create(x, y, 'bullet');
            bullet.setDepth(20).setData('damage', weapon.damage).setCircle(4);
            this.physics.velocityFromAngle(
                Phaser.Math.RadToDeg(angle + spread),
                weapon.bulletSpeed || CFG.BULLET_SPEED, bullet.body.velocity
            );
            const lifeMs = (weapon.range || 500) / (weapon.bulletSpeed || CFG.BULLET_SPEED) * 1000;
            this.time.delayedCall(lifeMs, () => { if (bullet && bullet.active) bullet.destroy(); });
        }
    }

    // ==========================================================
    // GROUND & MAP
    // ==========================================================
    drawGround() {
        const g = this.add.graphics(); g.setDepth(-10);
        // Solid green fill
        g.fillStyle(CFG.COLORS.GRASS, 1);
        g.fillRect(0, 0, CFG.MAP, CFG.MAP);
        // Grid lines
        const gs = CFG.GRID_SIZE;
        g.lineStyle(1, CFG.COLORS.GRID_LINE, 0.35);
        for (let x = gs; x < CFG.MAP; x += gs) {
            g.moveTo(x, 0); g.lineTo(x, CFG.MAP);
        }
        for (let y = gs; y < CFG.MAP; y += gs) {
            g.moveTo(0, y); g.lineTo(CFG.MAP, y);
        }
        g.strokePath();
        // Map border
        g.lineStyle(8, 0x3D5A28, 0.8); g.strokeRect(0, 0, CFG.MAP, CFG.MAP);
    }

    generateMap() {
        // 1. Generate Buildings FIRST to know where NOT to put things
        for (let i = 0; i < CFG.BUILDING_COUNT; i++) {
            const x = Phaser.Math.Between(150, CFG.MAP - 350), y = Phaser.Math.Between(150, CFG.MAP - 350);
            const w = 200, h = 200;
            const floor = this.add.tileSprite(x + w / 2, y + h / 2, w, h, 'tex_floor').setDepth(2);
            this.add.sprite(x + w / 2, y, 'tex_stone').setDepth(1).setScale(1.5, 0.8);
            this.add.sprite(x + w / 2, y + h, 'tex_stone').setDepth(1).setScale(1.5, 0.8);

            const wt = 12, dW = 60, dOff = (w - dW) / 2;
            const wallColor = 0x5d4037;
            const segments = [
                { rx: x, ry: y, rw: dOff, rh: wt }, { rx: x + dOff + dW, ry: y, rw: w - dOff - dW, rh: wt },
                { rx: x, ry: y + h - wt, rw: dOff, rh: wt }, { rx: x + dOff + dW, ry: y + h - wt, rw: w - dOff - dW, rh: wt },
                { rx: x, ry: y, rw: wt, rh: h }, { rx: x + w - wt, ry: y, rw: wt, rh: h }
            ];
            segments.forEach(seg => {
                const wg = this.add.graphics({ x: seg.rx, y: seg.ry }).setDepth(3);
                wg.fillStyle(wallColor, 1); wg.fillRect(0, 0, seg.rw, seg.rh);
                wg.lineStyle(2, 0x000000, 1); wg.strokeRect(0, 0, seg.rw, seg.rh);
                const zone = this.add.zone(seg.rx + seg.rw / 2, seg.ry + seg.rh / 2, seg.rw, seg.rh);
                this.physics.add.existing(zone, true); this.obstacles.add(zone);
            });
            const roof = this.add.tileSprite(x + w / 2, y + h / 2, w + 15, h + 15, 'tex_roof').setDepth(20);
            this.buildings.push({ x, y, w, h, roof });
        }

        const isInsideBuilding = (x, y, margin = 20) => {
            return this.buildings.some(b => x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin);
        };

        // 2. Trees
        for (let i = 0; i < CFG.TREE_COUNT; i++) {
            let x, y;
            let attempts = 0;
            do {
                x = Phaser.Math.Between(50, CFG.MAP - 50);
                y = Phaser.Math.Between(50, CFG.MAP - 50);
                attempts++;
            } while (isInsideBuilding(x, y, 40) && attempts < 10);

            const r = Phaser.Math.Between(20, 38);
            const g = this.add.graphics().setPosition(x, y).setDepth(25);
            g.fillStyle(CFG.COLORS.TREE_OUTLINE, 1); g.fillCircle(0, 0, r + 3);
            g.fillStyle(CFG.COLORS.TREE_FILL, 1); g.fillCircle(0, 0, r);
            g.fillStyle(0x4A8B35, 0.6); g.fillCircle(-r * 0.2, -r * 0.2, r * 0.55);
            const zone = this.add.zone(x, y, r * 0.8, r * 0.8);
            this.physics.add.existing(zone, true); this.obstacles.add(zone);
        }

        // 3. Rocks
        for (let i = 0; i < CFG.ROCK_COUNT; i++) {
            let x, y;
            do { x = Phaser.Math.Between(50, CFG.MAP - 50); y = Phaser.Math.Between(50, CFG.MAP - 50); } while (isInsideBuilding(x, y, 30));
            const r = Phaser.Math.Between(16, 30);
            const g = this.add.graphics().setPosition(x, y).setDepth(4);
            g.fillStyle(CFG.COLORS.ROCK_OUTLINE, 1); g.fillCircle(0, 0, r + 2);
            g.fillStyle(CFG.COLORS.ROCK, 1); g.fillCircle(0, 0, r);
            g.fillStyle(CFG.COLORS.ROCK_LIGHT, 0.4); g.fillCircle(-r * 0.2, -r * 0.2, r * 0.45);
            const zone = this.add.zone(x, y, r * 1.4, r * 1.4);
            this.physics.add.existing(zone, true); this.obstacles.add(zone);
        }

        // 4. Bushes
        for (let i = 0; i < 40; i++) {
            let x, y;
            do { x = Phaser.Math.Between(100, CFG.MAP - 100); y = Phaser.Math.Between(100, CFG.MAP - 100); } while (isInsideBuilding(x, y, 30));
            this.bushes.create(x, y, 'bush').setScale(Phaser.Math.FloatBetween(0.9, 1.2)).setDepth(15);
        }
    }

    // ==========================================================
    // LOOT
    // ==========================================================
    spawnLoot() {
        const types = ['pistol', 'shotgun', 'rifle', 'sniper', 'medkit', 'armor', 'ammo'];
        const weights = [30, 15, 20, 5, 15, 10, 5];
        for (let i = 0; i < CFG.LOOT_COUNT; i++) {
            const x = Phaser.Math.Between(80, CFG.MAP - 80), y = Phaser.Math.Between(80, CFG.MAP - 80);
            const type = this.weightedRandom(types, weights);
            const texMap = {
                pistol: 'loot_pistol', shotgun: 'loot_shotgun',
                rifle: 'loot_rifle', sniper: 'loot_sniper',
                medkit: 'loot_medkit', armor: 'loot_armor', ammo: 'loot_ammo'
            };
            const item = this.physics.add.sprite(x, y, texMap[type] || 'loot_ammo');
            this.lootItems.add(item);
            item.setDepth(3).setData('lootType', type);
            this.tweens.add({
                targets: item, scaleX: 1.2, scaleY: 1.2,
                duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        }
    }

    weightedRandom(items, weights) {
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
        return items[0];
    }

    pickupLoot(player, item) {
        const type = item.getData('lootType'); item.destroy();
        if (type === 'medkit') {
            myHp = Math.min(CFG.PLAYER_HP, myHp + 40);
            this.showFloatingText(player.x, player.y, '+40 HP', '#2ecc71');
        } else if (type === 'armor') {
            myArmor = Math.min(100, myArmor + 50);
            this.showFloatingText(player.x, player.y, '+50 Броня', '#3498db');
        } else if (type === 'ammo') {
            myWeapon.currentAmmo = Math.min(myWeapon.maxAmmo, myWeapon.currentAmmo + 30);
            this.showFloatingText(player.x, player.y, '+30 Патроны', '#f39c12');
        } else if (WEAPONS[type]) {
            myWeapon = { ...WEAPONS[type], currentAmmo: WEAPONS[type].ammo };
            this.showFloatingText(player.x, player.y, '🔫 ' + WEAPONS[type].name, '#ffffff');
        }
        this.updateHUD();
    }

    // ==========================================================
    // SHOOT (works for both desktop clicks and mobile aim joystick)
    // ==========================================================
    shoot(ptr) {
        if (isGameOver) return;
        const now = this.time.now;
        if (now - lastFired < myWeapon.fireRate) return;
        if (isReloading) return;
        if (myWeapon.currentAmmo <= 0) {
            this.reloadWeapon();
            return;
        }
        lastFired = now;
        myWeapon.currentAmmo--;

        let angle;
        if (ptr && ptr.x !== undefined) {
            // Desktop: aim at mouse pointer
            const worldPtr = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            angle = Phaser.Math.Angle.Between(this.myPlayer.x, this.myPlayer.y, worldPtr.x, worldPtr.y);
        } else {
            // Mobile: use aim joystick angle
            angle = ptr;
        }

        const pellets = (myWeapon.name === 'Дробовик') ? 5 : 1;
        for (let i = 0; i < pellets; i++) {
            const spread = pellets > 1 ? Phaser.Math.DegToRad(Phaser.Math.Between(-15, 15)) : 0;
            this.fireBullet(this.myPlayer.x, this.myPlayer.y, angle + spread, myWeapon);
        }
        this.cameras.main.shake(50, 0.003);
        this.updateHUD();

        const weaponKey = Object.keys(WEAPONS).find(k => WEAPONS[k].name === myWeapon.name) || 'pistol';
        socket.emit('shoot', {
            x: this.myPlayer.x, y: this.myPlayer.y,
            angle, weapon: weaponKey
        });
    }

    // Mobile: shoot using angle directly
    shootAtAngle(angle) {
        this.shoot(angle);
    }

    fireBullet(x, y, angle, weapon) {
        const bullet = this.bullets.create(x, y, 'bullet');
        bullet.setDepth(20).setData('damage', weapon.damage).setCircle(4);
        this.physics.velocityFromAngle(
            Phaser.Math.RadToDeg(angle),
            weapon.bulletSpeed || CFG.BULLET_SPEED, bullet.body.velocity
        );
        const lifeMs = (weapon.range || 500) / (weapon.bulletSpeed || CFG.BULLET_SPEED) * 1000;
        this.time.delayedCall(lifeMs, () => { if (bullet && bullet.active) bullet.destroy(); });
    }

    // ==========================================================
    // DAMAGE
    // ==========================================================
    takeDamage(amount) {
        if (isGameOver) return;
        let dmg = amount;
        if (myArmor > 0) { const ab = Math.min(myArmor, dmg * 0.5); myArmor -= ab; dmg -= ab; }
        myHp = Math.max(0, myHp - dmg);
        this.updateHUD();
        this.cameras.main.shake(100, 0.01);
        if (myHp <= 0) this.die();
    }

    die() {
        isGameOver = true;
        this.myPlayer.setTint(0xff0000);
        socket.emit('died');
        this.time.delayedCall(1500, () => {
            this.add.text(
                this.cameras.main.scrollX + this.cameras.main.width / 2,
                this.cameras.main.scrollY + this.cameras.main.height / 2,
                'ВЫ ВЫБЫЛИ', { fontSize: '48px', color: '#e74c3c', stroke: '#000', strokeThickness: 6 }
            ).setOrigin(0.5).setDepth(200);
        });
    }

    // ==========================================================
    // STORM
    // ==========================================================
    updateStorm(delta) {
        const phases = CFG.STORM_PHASES;
        const infoEl = document.getElementById('storm-info');
        if (stormPhase >= phases.length) {
            infoEl.textContent = '💀 Финальная зона!'; this.drawStorm(); return;
        }
        const phase = phases[stormPhase];
        if (stormState === 'waiting') {
            stormTimer -= delta;
            const secs = Math.max(0, Math.ceil(stormTimer / 1000));
            infoEl.textContent = '☁️ Шторм ' + (stormPhase + 1) + '/3 через ' + secs + 'с';
            if (stormTimer <= 0) {
                stormState = 'shrinking';
                stormTargetRadius = CFG.MAP * phase.targetFraction;
                stormCurrentDamageMult = phase.damageMult;
            }
        } else if (stormState === 'shrinking') {
            infoEl.textContent = '⚡ Шторм ' + (stormPhase + 1) + '/3 сжимается!';
            stormRadius = Math.max(stormTargetRadius, stormRadius - phase.speed * delta);
            if (stormRadius <= stormTargetRadius + 1) {
                stormRadius = stormTargetRadius;
                stormPhase++; stormState = 'waiting';
                if (stormPhase < phases.length) stormTimer = phases[stormPhase].delay;
            }
        }
        this.drawStorm();
    }

    drawStorm() {
        this.stormGraphics.clear();
        this.stormGraphics.fillStyle(0x4a0080, 0.4);
        this.stormGraphics.fillRect(0, 0, CFG.MAP, Math.max(0, stormCenterY - stormRadius));
        this.stormGraphics.fillRect(0, stormCenterY + stormRadius, CFG.MAP, CFG.MAP - (stormCenterY + stormRadius));
        this.stormGraphics.fillRect(0, Math.max(0, stormCenterY - stormRadius), Math.max(0, stormCenterX - stormRadius), stormRadius * 2);
        this.stormGraphics.fillRect(stormCenterX + stormRadius, Math.max(0, stormCenterY - stormRadius), CFG.MAP - (stormCenterX + stormRadius), stormRadius * 2);
        this.stormGraphics.lineStyle(4, 0x9b59b6, 0.9);
        this.stormGraphics.strokeCircle(stormCenterX, stormCenterY, stormRadius);
    }

    applyStormDamage() {
        if (stormPhase === 0 && stormState === 'waiting') return;
        if (isGameOver) return;
        const dist = Phaser.Math.Distance.Between(this.myPlayer.x, this.myPlayer.y, stormCenterX, stormCenterY);
        if (dist > stormRadius) {
            this.takeDamage(CFG.STORM_DAMAGE * 5 * stormCurrentDamageMult);
            this.showFloatingText(this.myPlayer.x, this.myPlayer.y - 20, '⚡ Шторм!', '#9b59b6');
        }
    }

    // ==========================================================
    // ROOFS & HUD
    // ==========================================================
    updateRoofs() {
        this.buildings.forEach(b => {
            const inside = this.myPlayer.x > b.x && this.myPlayer.x < b.x + b.w &&
                this.myPlayer.y > b.y && this.myPlayer.y < b.y + b.h;
            b.roof.setVisible(!inside);
        });
    }

    reloadWeapon() {
        if (isGameOver || isReloading || myWeapon.currentAmmo >= WEAPONS[Object.keys(WEAPONS).find(k => WEAPONS[k].name === myWeapon.name)].ammo) return;
        if (myWeapon.maxAmmo <= 0) {
            this.showFloatingText(this.myPlayer.x, this.myPlayer.y, 'Нет патронов в запасе!', '#e74c3c');
            return;
        }

        isReloading = true;
        this.showFloatingText(this.myPlayer.x, this.myPlayer.y, 'Перезарядка...', '#f1c40f');

        this.time.delayedCall(1500, () => {
            if (isGameOver) return;
            const wBase = Object.values(WEAPONS).find(w => w.name === myWeapon.name);
            const needed = wBase.ammo - myWeapon.currentAmmo;
            const toReload = Math.min(needed, myWeapon.maxAmmo);
            myWeapon.currentAmmo += toReload;
            myWeapon.maxAmmo -= toReload;
            isReloading = false;
            this.updateHUD();
        });
    }

    updateHUD() {
        document.getElementById('hp-bar').textContent = '❤️ ' + Math.round(myHp);
        document.getElementById('armor-bar').textContent = '🛡️ ' + Math.round(myArmor);
        document.getElementById('weapon-info').textContent = '🔫 ' + myWeapon.name;
        document.getElementById('ammo-info').textContent = '💥 ' + myWeapon.currentAmmo + ' / ' + myWeapon.maxAmmo;
    }

    showFloatingText(x, y, text, color) {
        const t = this.add.text(x, y, text, {
            fontSize: '14px', color, stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(100);
        this.tweens.add({
            targets: t, y: y - 50, alpha: 0,
            duration: 1200, ease: 'Power2', onComplete: () => t.destroy()
        });
    }

    // ==========================================================
    // MOVEMENT & INPUT
    // ==========================================================
    handleMovement() {
        const speed = CFG.PLAYER_SPEED;
        let vx = 0, vy = 0;

        if (isMobile) {
            // === MOBILE: analog joystick movement ===
            if (touchMove.active) {
                const R = CFG.JOYSTICK_RADIUS;
                const dist = Math.sqrt(touchMove.dx * touchMove.dx + touchMove.dy * touchMove.dy);
                const power = Math.min(dist / R, 1.0); // 0..1 analog strength
                if (dist > 3) { // dead zone
                    vx = (touchMove.dx / dist) * speed * power;
                    vy = (touchMove.dy / dist) * speed * power;
                }
            }

            // === MOBILE: aim joystick → rotate + auto-fire ===
            if (touchAim.active) {
                const dist = Math.sqrt(touchAim.dx * touchAim.dx + touchAim.dy * touchAim.dy);
                if (dist > 8) { // dead zone
                    const angle = Math.atan2(touchAim.dy, touchAim.dx);
                    this.myPlayer.setRotation(angle);
                    // Auto-fire while aiming
                    this.shootAtAngle(angle);
                }
            }
        } else {
            // === DESKTOP: WASD + mouse ===
            if (this.keys.A.isDown) vx = -speed;
            if (this.keys.D.isDown) vx = speed;
            if (this.keys.W.isDown) vy = -speed;
            if (this.keys.S.isDown) vy = speed;

            // Rotate toward mouse
            const ptr = this.input.activePointer;
            const worldPtr = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            const angle = Phaser.Math.Angle.Between(this.myPlayer.x, this.myPlayer.y, worldPtr.x, worldPtr.y);
            this.myPlayer.setRotation(angle);
        }

        // Normalize diagonal
        if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
        this.myPlayer.body.setVelocity(vx, vy);

        // Weapon follow player and rotate
        this.myGun.setPosition(this.myPlayer.x, this.myPlayer.y);
        this.myGun.setRotation(this.myPlayer.rotation);

        // Name label follow
        this.myNameLabel.setPosition(this.myPlayer.x, this.myPlayer.y - 25);

        // Hide in bushes logic
        let inBush = false;
        if (this.myPlayer && this.bushes) {
            this.physics.overlap(this.myPlayer, this.bushes, () => {
                const closest = this.physics.closest(this.myPlayer, this.bushes.getChildren());
                if (closest && Phaser.Math.Distance.Between(this.myPlayer.x, this.myPlayer.y, closest.x, closest.y) < 32) {
                    inBush = true;
                }
            });
        }

        if (inBush) {
            this.myPlayer.setAlpha(0.1);
            this.myNameLabel.setAlpha(0);
            this.myGun.setScale(1.6, 1.0); // Lengthen gun
            this.myGun.setX(this.myPlayer.x + Math.cos(this.myPlayer.rotation) * 5);
            this.myGun.setY(this.myPlayer.y + Math.sin(this.myPlayer.rotation) * 5);
        } else {
            this.myPlayer.setAlpha(1);
            this.myNameLabel.setAlpha(1);
            this.myGun.setScale(1.0, 1.0);
            this.myGun.setPosition(this.myPlayer.x, this.myPlayer.y);
        }

        // --- Crosshair position ---
        if (isMobile) {
            if (touchAim.active) {
                this.crosshair.setVisible(true);
                const dist = 150;
                this.crosshair.x = this.myPlayer.x + Math.cos(this.myPlayer.rotation) * dist;
                this.crosshair.y = this.myPlayer.y + Math.sin(this.myPlayer.rotation) * dist;
            } else {
                this.crosshair.setVisible(false);
            }
        } else {
            const ptr = this.input.activePointer;
            const worldPtr = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            this.crosshair.setPosition(worldPtr.x, worldPtr.y);
            this.crosshair.setVisible(true);
        }
    }

    // ==========================================================
    // MAIN LOOP
    // ==========================================================
    update(time, delta) {
        if (isGameOver) return;

        this.handleMovement();
        this.updateRoofs();
        if (this.keys.R.isDown) this.reloadWeapon();

        // Net sync
        if (time - lastSyncTime > CFG.NET_SYNC_RATE) {
            lastSyncTime = time;
            socket.emit('pos', {
                x: Math.round(this.myPlayer.x),
                y: Math.round(this.myPlayer.y),
                rot: Math.round(this.myPlayer.rotation * 100) / 100,
                hp: Math.round(myHp)
            });
        }

        // Interpolate network players
        netPlayers.forEach((p) => {
            if (p.dead) return;
            p.sprite.x = Phaser.Math.Linear(p.sprite.x, p.targetX, 0.15);
            p.sprite.y = Phaser.Math.Linear(p.sprite.y, p.targetY, 0.15);
            p.sprite.setRotation(p.targetRot);
            p.gun.setPosition(p.sprite.x, p.sprite.y);
            p.gun.setRotation(p.targetRot);
            p.label.setPosition(p.sprite.x, p.sprite.y - 25);

            // Enemy hiding in bush visibility
            let pInBush = false;
            this.physics.overlap(p.sprite, this.bushes, () => pInBush = true);
            p.sprite.setAlpha(pInBush ? 0 : 1);
            p.label.setAlpha(pInBush ? 0 : 1);
            p.gun.setAlpha(1); // gun always visible
        });

        // Storm & roofs
        this.updateStorm(delta);
        this.checkWin();
    }

    checkWin() {
        if (isGameOver) return;
        const aliveEnemies = [...netPlayers.values()].filter(p => !p.dead && p.hp > 0);
        if (aliveEnemies.length === 0 && netPlayers.size > 0) {
            isGameOver = true;
            this.add.text(
                this.cameras.main.scrollX + this.cameras.main.width / 2,
                this.cameras.main.scrollY + this.cameras.main.height / 2,
                '🏆 ПОБЕДА!', { fontSize: '56px', color: '#f1c40f', stroke: '#000', strokeThickness: 8 }
            ).setOrigin(0.5).setDepth(200);
            this.reportVictory();
        }
    }

    async reportVictory() {
        try {
            await fetch('/api/report-win', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId: roomId, winnerName: playerName, winnerId: socket.id
                })
            });
        } catch (e) { console.error("Failed to report victory:", e); }
    }
}

// ============================================================
// LAUNCH
// ============================================================
const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#6B8E4E',
    parent: 'game-container',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
    scene: [GameScene],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 3 } // support multi-touch
};

window.addEventListener('load', () => {
    console.log('Game Dream: Starting... Mobile:', isMobile);
    new Phaser.Game(config);
});
