# 九号出行 自动签到

九号出行（Ninebot）App 每日签到领 N 币的自动化脚本。一套代码同时支持 **Surge / Loon / Quantumult X / Stash / Egern / Shadowrocket / Node.js**，两种模式自动切换：

- **抓 Token**：MITM 拦截 `user-sign` 请求，从请求头提取 `Authorization` + `device_id`，本地持久化；
- **自动签到**：定时拉账号表，逐个查状态 → 未签则签到 → 复核连签天数 → 一条汇总通知。

> 原版 v1.0.0 作者 **凉心**。本仓库是修复版 v1.1.0，协议层（请求路径 / Header / Body）未改动，只修工程问题。逐条改动见 [REVIEW.md](REVIEW.md)。

## 特性

- 多账号（按 `deviceId` 去重追加，数量不限）
- 失败重试 + 指数退避，`4xx` 不重试（避免加重风控）
- 多账号请求间隔 + 随机抖动
- 通知逐号标识：`aabbcc…8899 新签 | 连签 4 天 | +5N币`
- Node 18+ 零依赖（用内置 `fetch`），退出码反映真实结果，可直接接 cron / 监控
- 6 个可调参数：`BaseUrl` `Timeout` `Retry` `Interval` `ShowDeviceId` `LogLevel`

## 目录

```
ninebot-sign.js        # 主脚本（客户端与 Node 通用）
DEPLOY.md              # 各平台配置 + NAS 定时部署 + 排障
REVIEW.md              # 代码审查报告（15 项问题）
tests/mock-test.js     # 本地 mock 验证，5 用例
```

## 快速开始

1. 按 [DEPLOY.md](DEPLOY.md) 第零节把 `{{SCRIPT_URL}}` 换成你能用的脚本地址；
2. 按对应客户端配置挂上 **http-request** 脚本 + **cron** 脚本，MITM hostname 加 `cn-cbu-gateway.ninebot.com`；
3. 打开 App 进签到页点一次签到 → 收到「获取成功」通知 → 手动运行一次定时脚本确认。

```ini
# Surge 示例
[Script]
九号出行抓Token = type=http-request,pattern=^https?://cn-cbu-gateway\.ninebot\.com/.*user-sign,script-path={{SCRIPT_URL}},requires-body=false,max-size=0
九号出行签到 = type=cron,cronexp="5 8 * * *",script-path={{SCRIPT_URL}},timeout=60,wake-system=true

[MITM]
hostname = cn-cbu-gateway.ninebot.com
```

## 参数

客户端用 `key=value&key2=value2`，Node 用环境变量 `NINEBOT_ARG`。

| 参数 | 默认 | 说明 |
|---|---|---|
| `LogLevel` | `info` | `off` / `error` / `warn` / `info` / `debug` |
| `Retry` | `2` | 网络错误 / 429 / 5xx 重试次数，0–5 |
| `Timeout` | `10` | 单请求超时（秒） |
| `Interval` | `800` | 多账号间隔（毫秒），另加 0–400ms 抖动 |
| `ShowDeviceId` | `true` | 通知里显示掩码 deviceId，`false` 时为 `账号#1` |
| `BaseUrl` | 官方网关 | 调试用，可指本地 mock |

## 验证

```bash
node tests/mock-test.js
# PASS  A 新签流程 + N币解析
# PASS  B 字符串状态码不误签
# PASS  C 503 重试 2 次后成功
# PASS  D 401 不重试 + 退出码 1
# PASS  E 多账号逐条标识
```

## 安全

`token` 等同于账号登录凭据。`ninebot-accounts.dat`、`ninebot-sign.log` 已在 `.gitignore` 里排除，**不要提交、不要截图分享**。NAS 上建议 `chmod 600`。

## 免责

仅供个人账号自动化学习使用。接口行为可能随时变更，签到失败请先重抓 Token；因使用本脚本导致的账号异常请自行承担。
