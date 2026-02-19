// ============================================================
// GAME DREAM - Battle Royale (Phaser 3 + Playroom SDK)
// ============================================================

// --- CONFIG ---
const CFG = {
    MAP: 3000,
    TILE: 40,
    PLAYER_SPEED: 220,
    PLAYER_HP: 100,
    BULLET_SPEED: 700,
    BULLET_DAMAGE: 20,
    STORM_START_DELAY: 45000,
    STORM_SHRINK_RATE: 0.15,
    STORM_DAMAGE: 1,
    STORM_TICK: 500,
    LOOT_COUNT: 80,
    TREE_COUNT: 150,
    ROCK_COUNT: 60,
    BUILDING_COUNT: 20,
    COLORS: {
        GRASS: 0x4a7c59,
        GRASS2: 0x3d6b4a,
        TREE: 0x2d5a27,
        ROCK: 0x7a7a7a,
        BUILDING: 0xc8b89a,
        ROOF: 0x8b6f47,
        LOOT_GUN: 0xf39c12,
        LOOT_MED: 0xe74c3c,
        LOOT_AMMO: 0x3498db,
    }
};

// --- WEAPONS ---
const WEAPONS = {
    pistol: { name: 'Пистолет', damage: 20, ammo: 7, maxAmmo: 30, fireRate: 400, bulletSpeed: 700, range: 500, color: 0xf39c12 },
    shotgun: { name: 'Дробовик', damage: 40, ammo: 2, maxAmmo: 16, fireRate: 900, bulletSpeed: 600, range: 300, color: 0xe67e22 },
    rifle: { name: 'Автомат', damage: 15, ammo: 30, maxAmmo: 90, fireRate: 120, bulletSpeed: 900, range: 700, color: 0x2ecc71 },
    sniper: { name: 'Снайперка', damage: 80, ammo: 5, maxAmmo: 20, fireRate: 1500, bulletSpeed: 1200, range: 1200, color: 0x9b59b6 },
};

// --- GLOBAL STATE ---
let myHp = CFG.PLAYER_HP;
let myArmor = 0;
let myWeapon = { ...WEAPONS.pistol, currentAmmo: WEAPONS.pistol.ammo };
let lastFired = 0;
let isGameOver = false;
let stormRadius;
let stormCenterX, stormCenterY;
let stormActive = false;
let stormTimer = CFG.STORM_START_DELAY;
let networkPlayers = new Map();
let playroomReady = false;

// ============================================================
// PHASER SCENE
// ============================================================
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    preload() {
        // Generate a simple circle texture for player
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        // Player texture (blue)
        g.fillStyle(0x3498db, 1);
        g.fillCircle(16, 16, 14);
        g.fillStyle(0xffffff, 0.3);
        g.fillCircle(12, 12, 5);
        g.fillStyle(0x333333, 1);
        g.fillRect(26, 13, 12, 6);
        g.generateTexture('player_blue', 40, 32);
        g.clear();

        // Enemy texture (red)
        g.fillStyle(0xe74c3c, 1);
        g.fillCircle(16, 16, 14);
        g.fillStyle(0xffffff, 0.3);
        g.fillCircle(12, 12, 5);
        g.fillStyle(0x333333, 1);
        g.fillRect(26, 13, 12, 6);
        g.generateTexture('player_red', 40, 32);
        g.clear();

        // Bullet texture
        g.fillStyle(0xffff00, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture('bullet', 8, 8);
        g.clear();
        g.destroy();

        // Load SVG icons
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

        // Ground
        this.drawGround();

        // Map objects
        this.obstacles = this.physics.add.staticGroup();
        this.buildings = [];
        this.generateMap();

        // Storm
        this.stormGraphics = this.add.graphics();
        this.stormGraphics.setDepth(50);
        stormCenterX = W / 2;
        stormCenterY = H / 2;
        stormRadius = W * 0.7;

        // Loot
        this.lootItems = this.physics.add.group();
        this.spawnLoot();

        // Bullets
        this.bullets = this.physics.add.group({ defaultKey: 'bullet' });
        this.enemyBullets = this.physics.add.group({ defaultKey: 'bullet' });

        // --- PLAYER ---
        const spawnX = Phaser.Math.Between(200, W - 200);
        const spawnY = Phaser.Math.Between(200, H - 200);
        this.myPlayer = this.physics.add.sprite(spawnX, spawnY, 'player_blue');
        this.myPlayer.setDepth(10);
        this.myPlayer.setCircle(14, 3, 3);
        this.myPlayer.setCollideWorldBounds(true);

        this.myNameLabel = this.add.text(spawnX, spawnY - 25, 'Вы', {
            fontSize: '11px', color: '#ffffff',
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(15);

        // Camera
        this.cameras.main.setBounds(0, 0, W, H);
        this.cameras.main.startFollow(this.myPlayer, true, 0.1, 0.1);
        this.cameras.main.setZoom(1.2);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            reload: Phaser.Input.Keyboard.KeyCodes.R,
        });
        // Only shoot on left mouse button
        this.input.on('pointerdown', (ptr) => {
            if (ptr.leftButtonDown()) this.shoot(ptr);
        });
        // Block right-click context menu to prevent key sticking
        this.input.mouse.disableContextMenu();
        // Reset keys when window loses focus
        window.addEventListener('blur', () => {
            this.myPlayer.body.setVelocity(0, 0);
        });

        // Collisions
        this.physics.add.collider(this.myPlayer, this.obstacles);
        this.physics.add.overlap(this.myPlayer, this.lootItems, this.pickupLoot, null, this);
        this.physics.add.overlap(this.bullets, this.obstacles, (bullet, obs) => { bullet.destroy(); });
        this.physics.add.overlap(this.enemyBullets, this.myPlayer, (player, bullet) => {
            const dmg = bullet.getData('damage') || CFG.BULLET_DAMAGE;
            bullet.destroy();
            this.takeDamage(dmg);
        });

        // Storm damage timer
        this.time.addEvent({
            delay: CFG.STORM_TICK,
            loop: true,
            callback: this.applyStormDamage,
            callbackScope: this
        });

        // Init multiplayer
        this.initPlayroom();

        // Hide loading
        document.getElementById('loading').style.display = 'none';
        console.log('Game Dream: Scene created!');
    }

    // ---- GROUND ----
    drawGround() {
        const g = this.add.graphics();
        g.setDepth(-10);
        const ts = CFG.TILE;
        for (let x = 0; x < CFG.MAP; x += ts) {
            for (let y = 0; y < CFG.MAP; y += ts) {
                const c = ((x + y) / ts) % 2 === 0 ? CFG.COLORS.GRASS : CFG.COLORS.GRASS2;
                g.fillStyle(c, 1);
                g.fillRect(x, y, ts, ts);
            }
        }
        g.lineStyle(6, 0x000000, 0.5);
        g.strokeRect(0, 0, CFG.MAP, CFG.MAP);
    }

    // ---- MAP GENERATION ----
    generateMap() {
        // Trees
        for (let i = 0; i < CFG.TREE_COUNT; i++) {
            const x = Phaser.Math.Between(50, CFG.MAP - 50);
            const y = Phaser.Math.Between(50, CFG.MAP - 50);
            const r = Phaser.Math.Between(15, 30);

            const g = this.add.graphics();
            g.fillStyle(CFG.COLORS.TREE, 1);
            g.fillCircle(0, 0, r);
            g.fillStyle(0x1a3d15, 0.5);
            g.fillCircle(-4, -4, r * 0.6);
            g.setPosition(x, y);
            g.setDepth(5);

            const zone = this.add.zone(x, y, r * 1.4, r * 1.4);
            this.physics.add.existing(zone, true);
            this.obstacles.add(zone);
        }

        // Rocks
        for (let i = 0; i < CFG.ROCK_COUNT; i++) {
            const x = Phaser.Math.Between(50, CFG.MAP - 50);
            const y = Phaser.Math.Between(50, CFG.MAP - 50);
            const w = Phaser.Math.Between(25, 50);
            const h = Phaser.Math.Between(20, 40);

            const g = this.add.graphics();
            g.fillStyle(CFG.COLORS.ROCK, 1);
            g.fillEllipse(0, 0, w, h);
            g.fillStyle(0x999999, 0.4);
            g.fillEllipse(-4, -4, w * 0.5, h * 0.5);
            g.setPosition(x, y);
            g.setDepth(4);

            const zone = this.add.zone(x, y, w * 0.8, h * 0.8);
            this.physics.add.existing(zone, true);
            this.obstacles.add(zone);
        }

        // Buildings
        for (let i = 0; i < CFG.BUILDING_COUNT; i++) {
            const x = Phaser.Math.Between(100, CFG.MAP - 200);
            const y = Phaser.Math.Between(100, CFG.MAP - 200);
            const w = Phaser.Math.Between(80, 160);
            const h = Phaser.Math.Between(80, 140);

            const floor = this.add.graphics();
            floor.fillStyle(CFG.COLORS.BUILDING, 1);
            floor.fillRect(x, y, w, h);
            floor.lineStyle(3, 0x6b4f2a, 1);
            floor.strokeRect(x, y, w, h);
            floor.setDepth(2);

            const roof = this.add.graphics();
            roof.fillStyle(CFG.COLORS.ROOF, 0.9);
            roof.fillRect(x + 4, y + 4, w - 8, h - 8);
            roof.setDepth(8);
            this.buildings.push({ x, y, w, h, roof });

            // Walls (with a door opening on the bottom side)
            const wt = 8;
            const doorW = 30;
            const doorOffset = Math.floor((w - doorW) / 2);
            const wallDefs = [
                { rx: x, ry: y, rw: w, rh: wt },                       // top
                { rx: x, ry: y + h - wt, rw: doorOffset, rh: wt },     // bottom-left
                { rx: x + doorOffset + doorW, ry: y + h - wt, rw: w - doorOffset - doorW, rh: wt }, // bottom-right
                { rx: x, ry: y, rw: wt, rh: h },                       // left
                { rx: x + w - wt, ry: y, rw: wt, rh: h },              // right
            ];
            wallDefs.forEach(({ rx, ry, rw, rh }) => {
                const zone = this.add.zone(rx + rw / 2, ry + rh / 2, rw, rh);
                this.physics.add.existing(zone, true);
                this.obstacles.add(zone);
            });
        }
    }

    // ---- LOOT ----
    spawnLoot() {
        const types = ['pistol', 'shotgun', 'rifle', 'sniper', 'medkit', 'armor', 'ammo'];
        const weights = [30, 15, 20, 5, 15, 10, 5];

        for (let i = 0; i < CFG.LOOT_COUNT; i++) {
            const x = Phaser.Math.Between(80, CFG.MAP - 80);
            const y = Phaser.Math.Between(80, CFG.MAP - 80);
            const type = this.weightedRandom(types, weights);

            const texMap = {
                pistol: 'loot_pistol', shotgun: 'loot_shotgun',
                rifle: 'loot_rifle', sniper: 'loot_sniper',
                medkit: 'loot_medkit', armor: 'loot_armor', ammo: 'loot_ammo'
            };
            const texKey = texMap[type] || 'loot_ammo';

            // Create sprite directly
            const item = this.physics.add.sprite(x, y, texKey);
            this.lootItems.add(item); // Add to group for collision
            item.setDepth(3);
            item.setData('lootType', type);
            item.refreshBody();

            // Pulse
            this.tweens.add({
                targets: item,
                scaleX: 1.2, scaleY: 1.2,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }
    }

    weightedRandom(items, weights) {
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[0];
    }

    pickupLoot(player, item) {
        const type = item.getData('lootType');
        item.destroy();

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

    // ---- SHOOT ----
    shoot(ptr) {
        if (isGameOver) return;
        const now = this.time.now;
        if (now - lastFired < myWeapon.fireRate) return;
        if (myWeapon.currentAmmo <= 0) {
            this.showFloatingText(this.myPlayer.x, this.myPlayer.y, 'Нет патронов!', '#e74c3c');
            return;
        }
        lastFired = now;
        myWeapon.currentAmmo--;

        const worldPtr = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
        const angle = Phaser.Math.Angle.Between(this.myPlayer.x, this.myPlayer.y, worldPtr.x, worldPtr.y);

        const pellets = (myWeapon.name === 'Дробовик') ? 5 : 1;
        for (let i = 0; i < pellets; i++) {
            const spread = pellets > 1 ? Phaser.Math.DegToRad(Phaser.Math.Between(-15, 15)) : 0;
            this.fireBullet(this.myPlayer.x, this.myPlayer.y, angle + spread, myWeapon);
        }

        this.cameras.main.shake(50, 0.003);
        this.updateHUD();

        // Network sync
        if (playroomReady) {
            try {
                const me = Playroom.myPlayer();
                if (me) me.setState('shoot', {
                    x: this.myPlayer.x, y: this.myPlayer.y,
                    angle, t: now
                });
            } catch (e) { }
        }
    }

    fireBullet(x, y, angle, weapon) {
        const bullet = this.bullets.create(x, y, 'bullet');
        bullet.setDepth(20);
        bullet.setData('damage', weapon.damage);
        bullet.setCircle(4);

        this.physics.velocityFromAngle(
            Phaser.Math.RadToDeg(angle),
            weapon.bulletSpeed || CFG.BULLET_SPEED,
            bullet.body.velocity
        );

        // Destroy after max range time
        const lifeMs = (weapon.range || 500) / (weapon.bulletSpeed || CFG.BULLET_SPEED) * 1000;
        this.time.delayedCall(lifeMs, () => {
            if (bullet && bullet.active) bullet.destroy();
        });
    }

    // ---- DAMAGE ----
    takeDamage(amount) {
        if (isGameOver) return;
        let dmg = amount;
        if (myArmor > 0) {
            const absorbed = Math.min(myArmor, dmg * 0.5);
            myArmor -= absorbed;
            dmg -= absorbed;
        }
        myHp = Math.max(0, myHp - dmg);
        this.updateHUD();
        this.cameras.main.shake(100, 0.01);
        if (myHp <= 0) this.die();
    }

    die() {
        isGameOver = true;
        this.myPlayer.setTint(0xff0000);
        this.time.delayedCall(1500, () => {
            this.add.text(
                this.cameras.main.scrollX + this.cameras.main.width / 2,
                this.cameras.main.scrollY + this.cameras.main.height / 2,
                'ВЫ ВЫБЫЛИ', {
                fontSize: '48px', color: '#e74c3c',
                stroke: '#000', strokeThickness: 6
            }
            ).setOrigin(0.5).setDepth(200);
        });
    }

    // ---- STORM ----
    updateStorm(delta) {
        if (stormActive) {
            stormRadius = Math.max(50, stormRadius - CFG.STORM_SHRINK_RATE * delta);
        } else {
            stormTimer -= delta;
            if (stormTimer <= 0) stormActive = true;
            const secs = Math.max(0, Math.ceil(stormTimer / 1000));
            document.getElementById('storm-info').textContent = '☁️ Шторм через ' + secs + 'с';
        }

        if (stormActive) {
            document.getElementById('storm-info').textContent = '⚡ Шторм сжимается!';
        }

        // Draw storm overlay using a mask approach:
        // Draw a full-map purple overlay, then use a separate circle shape 
        // We'll use the simple approach: redraw every frame
        this.stormGraphics.clear();

        // Purple overlay over the entire map
        this.stormGraphics.fillStyle(0x4a0080, 0.4);
        // We draw 4 rects around the safe circle to simulate the storm zone
        // This is a simpler, more reliable method than blend modes
        // Top rect
        this.stormGraphics.fillRect(0, 0, CFG.MAP, Math.max(0, stormCenterY - stormRadius));
        // Bottom rect
        this.stormGraphics.fillRect(0, stormCenterY + stormRadius, CFG.MAP, CFG.MAP - (stormCenterY + stormRadius));
        // Left rect (between top and bottom)
        this.stormGraphics.fillRect(0, Math.max(0, stormCenterY - stormRadius), Math.max(0, stormCenterX - stormRadius), stormRadius * 2);
        // Right rect
        this.stormGraphics.fillRect(stormCenterX + stormRadius, Math.max(0, stormCenterY - stormRadius), CFG.MAP - (stormCenterX + stormRadius), stormRadius * 2);

        // Storm border circle
        this.stormGraphics.lineStyle(4, 0x9b59b6, 0.9);
        this.stormGraphics.strokeCircle(stormCenterX, stormCenterY, stormRadius);
    }

    applyStormDamage() {
        if (!stormActive || isGameOver) return;
        const dist = Phaser.Math.Distance.Between(this.myPlayer.x, this.myPlayer.y, stormCenterX, stormCenterY);
        if (dist > stormRadius) {
            this.takeDamage(CFG.STORM_DAMAGE * 5);
            this.showFloatingText(this.myPlayer.x, this.myPlayer.y - 20, '⚡ Шторм!', '#9b59b6');
        }
    }

    // ---- ROOF FADE ----
    updateRoofs() {
        this.buildings.forEach(b => {
            const inside = this.myPlayer.x > b.x && this.myPlayer.x < b.x + b.w &&
                this.myPlayer.y > b.y && this.myPlayer.y < b.y + b.h;
            b.roof.setAlpha(inside ? 0.1 : 0.9);
        });
    }

    // ---- PLAYROOM ----
    async initPlayroom() {
        if (typeof Playroom === 'undefined') {
            console.warn('Playroom SDK not loaded, running in solo mode.');
            return;
        }
        try {
            await Playroom.insertCoin({
                gameId: 'game-dream-br',
                maxPlayersPerRoom: 8,
                skipLobby: false,
            });

            Playroom.onPlayerJoin((state) => {
                const id = state.id;
                if (id === Playroom.myPlayer()?.id) return;

                const enemy = this.physics.add.sprite(
                    Phaser.Math.Between(200, CFG.MAP - 200),
                    Phaser.Math.Between(200, CFG.MAP - 200),
                    'player_red'
                );
                enemy.setDepth(9);

                const nameLabel = this.add.text(0, 0, state.getProfile()?.name || 'Player', {
                    fontSize: '11px', color: '#ffcccc',
                    stroke: '#000000', strokeThickness: 3
                }).setOrigin(0.5).setDepth(15);

                networkPlayers.set(id, { sprite: enemy, label: nameLabel, state });
                this.updatePlayerCount();

                state.onQuit(() => {
                    const p = networkPlayers.get(id);
                    if (p) { p.sprite.destroy(); p.label.destroy(); }
                    networkPlayers.delete(id);
                    this.updatePlayerCount();
                });
            });

            playroomReady = true;
            console.log('Playroom ready!');
        } catch (e) {
            console.warn('Playroom init failed (solo mode):', e.message);
            playroomReady = false;
        }
    }

    updatePlayerCount() {
        const count = networkPlayers.size + 1;
        document.getElementById('player-count').textContent = '👥 ' + count + ' игрок' + (count === 1 ? '' : 'ов');
    }

    // ---- HUD ----
    updateHUD() {
        document.getElementById('hp-bar').style.width = myHp + '%';
        document.getElementById('armor-bar').style.width = myArmor + '%';
        document.getElementById('weapon-info').textContent =
            '🔫 ' + myWeapon.name + ' | ' + myWeapon.currentAmmo + '/' + myWeapon.maxAmmo;
    }

    // ---- FLOATING TEXT ----
    showFloatingText(x, y, text, color) {
        const t = this.add.text(x, y, text, {
            fontSize: '14px', color: color,
            stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(100);

        this.tweens.add({
            targets: t,
            y: y - 50,
            alpha: 0,
            duration: 1200,
            ease: 'Power2',
            onComplete: () => t.destroy()
        });
    }

    // ---- MAIN LOOP ----
    update(time, delta) {
        if (isGameOver) return;

        // Movement
        const speed = CFG.PLAYER_SPEED;
        let vx = 0, vy = 0;
        if (this.cursors.left.isDown || this.wasd.left.isDown) vx = -speed;
        if (this.cursors.right.isDown || this.wasd.right.isDown) vx = speed;
        if (this.cursors.up.isDown || this.wasd.up.isDown) vy = -speed;
        if (this.cursors.down.isDown || this.wasd.down.isDown) vy = speed;
        if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
        this.myPlayer.body.setVelocity(vx, vy);

        // Rotate toward mouse
        const ptr = this.input.activePointer;
        const worldPtr = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
        const angle = Phaser.Math.Angle.Between(this.myPlayer.x, this.myPlayer.y, worldPtr.x, worldPtr.y);
        this.myPlayer.setRotation(angle);

        // Name label follow
        if (this.myNameLabel) {
            this.myNameLabel.setPosition(this.myPlayer.x, this.myPlayer.y - 25);
        }

        // Playroom sync
        if (playroomReady && time % 50 < delta) {
            try {
                const me = Playroom.myPlayer();
                if (me) {
                    me.setState('pos', { x: Math.round(this.myPlayer.x), y: Math.round(this.myPlayer.y) });
                    me.setState('rot', angle);
                    me.setState('hp', myHp);
                }
            } catch (e) { }
        }

        // Update enemies from network
        networkPlayers.forEach((p) => {
            try {
                const pos = p.state.getState('pos');
                const rot = p.state.getState('rot');
                if (pos) {
                    p.sprite.x = Phaser.Math.Linear(p.sprite.x, pos.x, 0.2);
                    p.sprite.y = Phaser.Math.Linear(p.sprite.y, pos.y, 0.2);
                    p.label.setPosition(p.sprite.x, p.sprite.y - 25);
                }
                if (rot != null) p.sprite.setRotation(rot);
            } catch (e) { }
        });

        // Storm
        this.updateStorm(delta);

        // Roofs
        this.updateRoofs();

        // Reload
        if (Phaser.Input.Keyboard.JustDown(this.wasd.reload)) {
            myWeapon.currentAmmo = myWeapon.ammo;
            this.showFloatingText(this.myPlayer.x, this.myPlayer.y, '🔄 Перезарядка', '#ffffff');
            this.updateHUD();
        }

        // Win check
        this.checkWin();
    }

    checkWin() {
        if (isGameOver) return;
        const alive = [...networkPlayers.values()].filter(p => {
            try { return (p.state.getState('hp') || 100) > 0; } catch (e) { return false; }
        });
        if (alive.length === 0 && networkPlayers.size > 0) {
            isGameOver = true;
            this.add.text(
                this.cameras.main.scrollX + this.cameras.main.width / 2,
                this.cameras.main.scrollY + this.cameras.main.height / 2,
                '🏆 ПОБЕДА!', {
                fontSize: '56px', color: '#f1c40f',
                stroke: '#000', strokeThickness: 8
            }
            ).setOrigin(0.5).setDepth(200);
        }
    }
}

// ============================================================
// PHASER CONFIG & LAUNCH
// ============================================================
const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#1a1a2e',
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: false }
    },
    scene: [GameScene],
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

window.addEventListener('load', () => {
    console.log('Game Dream: Starting Phaser...');
    new Phaser.Game(config);
});
