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
ADMIN_TELEGRAM_IDS=<ваш Telegram ID>
```

`ADMIN_TELEGRAM_IDS` открывает вкладку «Админ» прямо в MiniApp. Свой ID видно в игре на вкладке «Профиль». Если нужна админка и в обычном браузере, добавьте ещё `ADMIN_TOKEN=<openssl rand -hex 24>`: это пароль для страницы `/admin`.

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

Откройте `https://fin.izzinet.xyz` в браузере: должен появиться терминал с живым графиком. Админка открывается во вкладке «Админ» в MiniApp у игроков из `ADMIN_TELEGRAM_IDS`, а при заданном `ADMIN_TOKEN` ещё и по адресу `https://fin.izzinet.xyz/admin`.

## 5. Telegram

Бот при запуске сам ставит кнопку меню «Играть», которая открывает MiniApp. Напишите боту `/start` и нажмите «Открыть терминал».

Дополнительно в @BotFather можно:

- `/newapp` — создать прямую ссылку вида `t.me/<бот>/<app>` с адресом `https://fin.izzinet.xyz`;
- `/setdescription` и `/setuserpic` — описание и аватар бота.

## Если на сервере уже есть Caddy для других сайтов

Тогда порты 80 и 443 заняты, и наш `web` встаёт за существующий Caddy: он не публикует порты, а подключается к Docker-сети вашего Caddy под именем `financio-web`.

1. Узнайте сеть контейнера Caddy и где лежит его Caddyfile:

   ```bash
   docker inspect caddy -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   docker inspect caddy -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
   ```

2. Добавьте в `.env` (вместо `<сеть>` — имя из первой команды):

   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
   PROXY_NETWORK=<сеть>
   ```

3. Запустите игру: `docker compose --profile bot up -d --build`.

4. Допишите в Caddyfile вашего Caddy блок и перечитайте конфиг:

   ```
   fin.izzinet.xyz {
   	reverse_proxy financio-web:80
   }
   ```

   ```bash
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

Сертификат для домена выпустит ваш Caddy, как и для остальных сайтов.

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
