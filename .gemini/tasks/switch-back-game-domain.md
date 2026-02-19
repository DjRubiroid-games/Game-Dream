# ⚠️ НАПОМИНАНИЕ: Вернуть домен game.znak.pics

## Что произошло
19.02.2026 — временно переключили `GAME_URL` с `https://game.znak.pics` на `https://api.znak.pics`, потому что админ ещё не добавил A-запись в Cloudflare DNS.

## Что нужно сделать

### Шаг 1: Убедиться, что DNS настроен
Попросить админа добавить в Cloudflare:
- **Type:** A
- **Name:** game
- **IPv4:** 178.62.237.252
- **Proxy:** включить (оранжевое облачко)

Проверить: `nslookup game.znak.pics` — должен вернуть IP.

### Шаг 2: Переключить обратно
```bash
ssh -i do-3x.txt -p 8756 root@178.62.237.252
sed -i 's|GAME_URL=https://api.znak.pics|GAME_URL=https://game.znak.pics|' bot/.env
cd bot && docker-compose down && docker-compose up -d
```

### Шаг 3: Проверить
Открыть `https://game.znak.pics/game.html` — должна загрузиться игра.

## Статус
- [ ] DNS-запись добавлена админом
- [ ] GAME_URL переключен обратно на game.znak.pics
- [ ] Проверено — игра работает
