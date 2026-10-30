# Деплой на сервер

Вся игра работает на одном сервере через Docker Compose:

- `web` — Caddy: раздаёт MiniApp, проксирует `/api` и `/ws` на сервер и сам получает HTTPS-сертификат Let's Encrypt;
- `server` — API, поток цен и WebSocket (наружу не открыт, доступен только через Caddy);
- `bot` — Telegram-бот (запускается с профилем `bot`).

Ниже пример для домена `fin.izzinet.xyz`.

## 1. DNS

У регистратора домена `izzinet.xyz` создайте A-запись:

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `fin` | IP вашего сервера |

Проверка: `ping fin.izzinet.xyz` должен показать IP сервера (иногда DNS обновляется до часа).
Если домен за Cloudflare, на время первого запуска выключите оранжевое облако (режим «DNS only»), иначе Caddy не получит сертификат.

## 2. Сервер

Подойдёт любой VPS с Ubuntu 22.04+ и 1 ГБ RAM. Порты 80 и 443 должны быть открыты.

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Проверка, что Binance доступен с этого IP (с американских серверов он закрыт)
curl https://fapi.binance.com/fapi/v1/ping
# Ответ должен быть {}
```

## 3. Код и настройки

```bash
git clone https://github.com/vladosik1029/Financio.git financio
cd financio
cp .env.example .env
nano .env
```

В `.env` обязательно:

```
DOMAIN=fin.izzinet.xyz
BOT_TOKEN=<токен от BotFather>
WEBAPP_URL=https://fin.izzinet.xyz
CORS_ORIGINS=https://fin.izzinet.xyz
PRICE_FEED=binance
DEV_AUTH_BYPASS=false
ADMIN_TOKEN=<openssl rand -hex 24>
```

Игроки и сделки хранятся во встроенной базе в Docker-томе `server_data`, он переживает перезапуски и обновления. Резервная копия: `docker compose stop server`, затем `docker run --rm -v financio_server_data:/data -v $PWD:/backup alpine tar czf /backup/financio-db.tgz /data`, затем `docker compose start server`.

## 4. Запуск

```bash
docker compose --profile bot up -d --build
```

Проверка:

```bash
docker compose ps                              # web, server, bot в статусе running
curl https://fin.izzinet.xyz/api/health        # {"ok":true,"feed":"binance","stale":false}
docker compose logs -f server                  # строка «Binance: подключено»
```

Откройте `https://fin.izzinet.xyz` в браузере: должен появиться терминал с живым графиком. Админка открывается по адресу `https://fin.izzinet.xyz/admin`, пароль — `ADMIN_TOKEN`.

## 5. Telegram

Бот при запуске сам ставит кнопку меню «Играть», которая открывает MiniApp. Напишите боту `/start` и нажмите «Открыть терминал».

Дополнительно в @BotFather можно:

- `/newapp` — создать прямую ссылку вида `t.me/<бот>/<app>` с адресом `https://fin.izzinet.xyz`;
- `/setdescription` и `/setuserpic` — описание и аватар бота.

## Обновление

```bash
cd financio
git pull
docker compose --profile bot up -d --build
```

## Если что-то не работает

| Симптом | Что проверить |
| --- | --- |
| Сайт не открывается по HTTPS | A-запись указывает на сервер, порты 80/443 открыты, `docker compose logs web` |
| Нет цен, «Цены устарели» | `curl https://fapi.binance.com/fapi/v1/ping` с сервера; при блокировке нужен сервер в другой стране |
| В MiniApp профиль «Trader» вместо имени | `BOT_TOKEN` в `.env` совпадает с ботом, через которого открыт MiniApp |
| Бот не отвечает | `docker compose logs bot`, не запущен ли этот же бот где-то ещё |
