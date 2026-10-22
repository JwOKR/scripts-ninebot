# 九号出行签到 · 部署说明

> 适用版本：`ninebot-sign.js` v1.1.0
> 支持：Surge / Loon / Quantumult X / Stash / Egern / Shadowrocket / Node.js 18+

工作方式有两种模式，脚本自己判断，不需要配两个文件：

| 模式 | 触发方式 | 干什么 |
|---|---|---|
| 抓 Token | 拦截 `user-sign` 请求（http-request 脚本） | 从请求头取 `Authorization` + `device_id`，存进本地 |
| 签到 | 定时任务（cron / task） | 读账号表，逐个签到，发一条汇总通知 |

**必须先完成抓 Token，定时任务才有账号可签。**

---

## 零、脚本地址

**最省事**：直接用仓库里现成的客户端配置文件，按 URL 安装，不用抄配置——

| 客户端 | 安装链接 |
|---|---|
| Surge | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot.sgmodule` |
| Loon | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot.plugin` |
| Quantumult X | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot-qx.conf`（定时任务需手动加一行） |

细节见 [clients/README.md](clients/README.md)。

想手动配的话，脚本地址用下面两条之一（都实测 HTTP 200）：

```
主用  https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js
备用  https://cdn.jsdelivr.net/gh/JwOKR/scripts-ninebot@main/ninebot-sign.js
```

- 国内直连 `raw.githubusercontent.com` 偶尔会抽，拉不到就换 jsDelivr。
- jsDelivr 有缓存，改完脚本可能几分钟才生效；急着验证就用 raw 并加个 `?t=时间戳` 破缓存。
- 脚本里没有 token、没有账号数据，公开不泄露任何凭据。

> 如果以后改回私有仓库，这两条都会失效，需要换成带鉴权的 Worker 反代（`Accept: application/vnd.github.raw` + fine-grained PAT 的 Contents: Read）。

---

## 一、先抓 Token（所有平台通用步骤）

1. 把脚本挂到客户端（下面各平台配置），**打开 MITM 并信任证书**，hostname 加 `cn-cbu-gateway.ninebot.com`。
2. 手机打开 **九号出行 App**，登录要签到的账号。
3. 进「我的」→ 签到 / 我的 N 币 页面，**点一次签到**（或下拉刷新）。
4. 收到通知：**`九号出行 签到 · 获取成功 · 已保存新账号 aabbcc…8899`** → 抓取成功。
5. 再挂定时任务，手动「立即运行」一次，确认能收到签到结果通知。

多账号：App 里退出登录 → 换下一个号 → 重复第 3 步。脚本按 `deviceId` 去重追加，最多不限个数。

> 抓 Token 时 App 必须在前台，后台可能走缓存不产生请求。

---

## 二、Surge

```ini
[Script]
# 抓 Token：只取请求头，不需要 body
九号出行抓Token = type=http-request,pattern=^https?://cn-cbu-gateway\.ninebot\.com/.*user-sign,script-path=https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js,requires-body=false,max-size=0

# 每天 11:45 签到
九号出行签到 = type=cron,cronexp="45 11 * * *",script-path=https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js,timeout=60,wake-system=true,argument="LogLevel=info&Retry=2&Interval=800"

[MITM]
hostname = cn-cbu-gateway.ninebot.com
```

- `argument` 可选，不写就用默认值。
- `cronexp` 是 5 段标准 cron（分 时 日 月 周）。
- 想手动测：Surge → 首页 → 脚本 → 找到该脚本 → 立即运行。

---

## 三、Loon

存成 `九号出行签到.plugin`，用 `plugin=` 引入：

```ini
#!name=九号出行签到
#!desc=自动签到领N币，多账号，失败重试
#!author=凉心 / 蛋卷

[Script]
http-request ^https?://cn-cbu-gateway\.ninebot\.com/.*user-sign script-path=https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js, requires-body=false, tag=九号出行抓Token
cron "45 11 * * *" script-path=https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js, tag=九号出行签到, enabled=true, timeout=60

[MITM]
hostname = %APPEND% cn-cbu-gateway.ninebot.com
```

Loon 的 `timeout` 单位是秒。

---

## 四、Quantumult X

```ini
[rewrite_local]
^https?:\/\/cn-cbu-gateway\.ninebot\.com\/.*user-sign url script-request-header https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js

[task_local]
45 11 * * * https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js, tag=九号出行签到, enabled=true

[mitm]
hostname = cn-cbu-gateway.ninebot.com
```

**注意类型选 `script-request-header`，不要选 `script-request-body`。** 只需要请求头，选 body 会多劫持一次响应，且 `$done` 语义不同。

QX 不支持脚本参数，改默认值需要直接改脚本里的 `CFG`。

---

## 五、Stash / Egern / Shadowrocket

这三个平台的脚本 API 与 Surge 同族（`$httpClient` / `$persistentStore` / `$notification`），脚本可直接用，配置按下图思路在各自的 YAML / 界面里建两条：

1. 一条 **http-request**，匹配 `^https?://cn-cbu-gateway\.ninebot\.com/.*user-sign`（Stash 用 `- http-request,<pattern>,<script名>` 规则）；
2. 一条 **cron**，每天一次；
3. MITM hostname 加 `cn-cbu-gateway.ninebot.com`。

> 各家 YAML 字段名有差异，以你当前版本的官方文档为准。这三个平台我没有实机验证，配好后先用「立即运行」确认能收到通知。

---

## 六、Node.js / 飞牛 NAS（无客户端，纯定时）

要求 **Node 18+**（用到内置 `fetch`，零 npm 依赖）。

### 目录结构

```
/vol1/1000/ninebot/
├── ninebot-sign.js
├── ninebot-accounts.dat   # 账号表，脚本自动生成
├── ninebot-sign.log       # 运行日志
└── run.sh
```

### run.sh

```sh
#!/bin/sh
cd "$(dirname "$0")" || exit 1
export NINEBOT_DATA="$PWD/ninebot-accounts.dat"
export NINEBOT_LOG="$PWD/ninebot-sign.log"
export NINEBOT_ARG="LogLevel=info&Retry=2&Interval=800"
exec "$(command -v node)" ninebot-sign.js
```

```sh
chmod +x run.sh
chmod 600 ninebot-accounts.dat 2>/dev/null
```

### 怎么拿到账号表

NAS 上没法用 MITM 抓包。两个办法：

1. **从客户端搬过来**：先在手机客户端抓到 Token，然后手动写一行到 `ninebot-accounts.dat`：
   ```
   deviceId:token
   ```
   多个账号用 `;` 分隔。deviceId / token 从客户端存储里取（Surge 的持久化存储、QX 的 `Ninebot.Accounts` 键）。
2. **走代理抓一次**：把手机代理指到局域网里的抓包工具，抓一次 `user-sign` 请求，从请求头抄 `device_id` 和 `Authorization`。

### 定时任务

`crontab -e`（飞牛 OS 建议用 `sudo` 写到 `/etc/cron.d/ninebot-sign` 更稳）：

```cron
# /etc/cron.d/ninebot-sign
SHELL=/bin/sh
45 11 * * * root /vol1/1000/ninebot/run.sh
```

或者用飞牛自带的「计划任务」界面，命令填 `/vol1/1000/ninebot/run.sh`，周期每天 11:45。

### 用 Docker 跑（宿主机 Node 版本太老时）

`docker-compose.yml`：

```yaml
services:
  ninebot-sign:
    image: node:22-alpine
    container_name: ninebot-sign
    working_dir: /app
    volumes:
      - ./:/app
    environment:
      NINEBOT_DATA: /app/ninebot-accounts.dat
      NINEBOT_LOG: /app/ninebot-sign.log
      NINEBOT_ARG: LogLevel=info&Retry=2&Interval=800
    command: ["node", "ninebot-sign.js"]
```

执行：`sudo docker compose run --rm ninebot-sign`（飞牛上新版 Docker 用 `docker compose`，空格）。

手动验证：

```sh
/vol1/1000/ninebot/run.sh; echo "退出码=$?"
tail -20 /vol1/1000/ninebot/ninebot-sign.log
```

退出码 `0` = 全部成功，`1` = 有账号失败或未配置账号。可以拿这个接监控告警。

---

## 七、参数表

客户端脚本参数格式 `key=value&key2=value2`，Node 环境用环境变量 `NINEBOT_ARG`。

| 参数 | 默认 | 说明 |
|---|---|---|
| `LogLevel` | `info` | `off` / `error` / `warn` / `info` / `debug` |
| `Retry` | `2` | 网络错误、429、5xx 的重试次数，0–5 |
| `RetryWait` | `3000` | 重试退避基数（毫秒），指数增长：3s → 6s → 12s |
| `Timeout` | `10` | 单请求超时（秒） |
| `Interval` | `800` | 多账号之间的间隔（毫秒），另加 0–400ms 随机抖动 |
| `ShowDeviceId` | `true` | 通知里显示掩码后的 deviceId；`false` 时显示 `账号#1` |
| `Policy` | 空 | 指定节点/策略。网络不通时设 `DIRECT` 强制直连（Loon→`node`，Surge→`policy`，Stash→`X-Stash-Selected-Proxy`，QX→`opts.policy`） |
| `BaseUrl` | `https://cn-cbu-gateway.ninebot.com` | 一般不用改，调试时指本地 mock |

---

## 八、排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 通知「未配置账号」 | 一条都没抓到 | 检查 MITM 是否真的开启、证书是否信任、hostname 是否加了域名；App 里必须进签到页并点签到 |
| 通知「失败: 系统错误」 | **Token 失效**（实测接口失效时就是回这个，不是 401） | 重抓 Token |
| `Request timeout` / `HTTPClient request failed` | 网络层问题：客户端未联网、当前节点不可用、或流量被走到国外代理 | 加 `Policy=DIRECT` 强制直连；确认客户端 VPN 处于连接状态；v1.1.0 还有个 timeout 单位 bug，升到 1.1.1 再说 |
| **手动跑成功、定时任务跑失败** | 定时触发那一刻网络/隧道还没就绪（iOS 唤醒后 VPN 重建需要几秒） | v1.1.2 起退避基数 3s，能等到网络恢复；仍失败就把时间挪到设备常亮时段，或加 `Retry=4&RetryWait=5000` |
| 日志里看不到重试过程 | 老版本重试日志是 debug 级别 | v1.1.1 起改为 info 级别，默认就能看到「第 N/M 次重试」（v1.1.2 起还带上次失败原因） |
| 通知「失败: HTTP 401」 | Token 或设备头不对 | 重抓；确认 deviceId 与 token 是同一个账号的 |
| 通知里看不到 deviceId | `ShowDeviceId=false` | 改参数 |
| QX 抓不到 | 用了 `script-request-body`，或 mitm 没开 | 改成 `script-request-header` |
| Node 报「没有内置 fetch」 | Node < 18 | 升级，或用上面的 node:22-alpine 镜像 |
| 每天都提示「已签」 | 正常，签到幂等 | 无需处理 |
| Cron 里跑但没日志 | crontab 里没 `cd` 到脚本目录 | 用 `run.sh` 包一层 |
| 升级后旧账号没了 | 原版 Node 分支有把账号表解析成空对象的 bug | 重抓一次 Token（修复版存储键没变，客户端环境不受影响） |

---

## 九、安全提醒

- **`token` 等同于账号登录凭据**，拿到就能直接调接口签到/查询。别把配置、通知截图、`ninebot-accounts.dat` 发给别人，也不要提交到公开仓库。
- 客户端存储（Surge `$persistentStore` / QX `$prefs`）是明文；NAS 上的 `ninebot-accounts.dat` 建议 `chmod 600`。
- 抓完 Token 建议关掉 MITM（省电、减握手开销）；保留也行，token 变了脚本会自动更新。
- 只给一个账号签名额时，别把多个号塞同一个 deviceId，会串。

---

## 十、换用修复版要注意什么

- 存储键仍是 `Ninebot.Accounts`，**客户端直接替换脚本 URL 即可**，已抓的账号保留。
- 但原版 Node 分支因为把账号表当 JSON 解析，**NAS 上原有账号大概率是空的**，升级后需要重新导一次。
- 参数名全兼容原版 `LogLevel`，其余新增参数不配就用默认值。
