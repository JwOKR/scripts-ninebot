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
ninebot-sign.js            # 主脚本（客户端与 Node 通用）
clients/                   # 各客户端配置文件，可 URL 一键安装
  ├── ninebot.sgmodule     #   Surge
  ├── ninebot.plugin       #   Loon
  ├── ninebot-qx.conf      #   Quantumult X 远程重写
  └── README.md            #   各客户端安装步骤
DEPLOY.md                  # 详细部署 + NAS 定时 + 排障
REVIEW.md                  # 代码审查报告（15 项问题）
tests/mock-test.js         # 本地 mock 验证，5 用例
```

## 客户端一键安装

不想手抄配置就用这些链接，装完开 MITM 就能抓 Token：

| 客户端 | 安装链接 |
|---|---|
| **Surge** | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot.sgmodule` |
| **Loon** | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot.plugin` |
| **Quantumult X** | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot-qx.conf`（定时任务仍需手动加一行，见 [clients/README.md](clients/README.md)） |
| **Stash / Egern / Shadowrocket** | 先试 Surge 模块，不行按 [DEPLOY.md](DEPLOY.md) 手动建 |

各客户端具体步骤：[clients/README.md](clients/README.md)

## 脚本地址

```
https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js
https://cdn.jsdelivr.net/gh/JwOKR/scripts-ninebot@main/ninebot-sign.js   # raw 拉不到时的备用
```

## 快速开始

1. 上面链接装客户端配置（或按 [DEPLOY.md](DEPLOY.md) 手动配）；
2. **开 MITM 并信任证书**，hostname 已包含在配置里；
3. 打开 App 进签到页点一次签到 → 收到「获取成功」通知 → 手动运行一次定时脚本确认。

手动配的话，最小配置长这样：

```ini
# Surge 示例
[Script]
九号出行抓Token = type=http-request,pattern=^https?://cn-cbu-gateway\.ninebot\.com/.*user-sign,script-path=https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js,requires-body=false,max-size=0
九号出行签到 = type=cron,cronexp="45 11 * * *",script-path=https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js,timeout=60,wake-system=true

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
| `Policy` | 空（跟随当前节点） | 指定节点/策略，排查网络问题时设 `DIRECT` 强制直连 |
| `BaseUrl` | 官方网关 | 调试用，可指本地 mock |

## 验证

```bash
node tests/mock-test.js             # 业务流程：5 项
node tests/platform-timeout-test.js # 平台 timeout 单位与策略映射：7 项
```

后者是 v1.1.1 加的回归测试——v1.1.0 曾因把 `timeout` 统一按秒传给 Loon（Loon 收毫秒）导致 100% 超时，见 [REVIEW.md](REVIEW.md) 第七节。

## 更新日志

| 版本 | 内容 |
|---|---|
| 1.1.1 | 修复 Loon / QX 的 `timeout` 单位（毫秒 vs 秒）；新增 `Policy` 参数；重试日志提到 info 级别 |
| 1.1.0 | 首个修复版：Node 零依赖、账号不丢、字符串状态码、重试退避、多账号标识 |

## 安全

`token` 等同于账号登录凭据。`ninebot-accounts.dat`、`ninebot-sign.log` 已在 `.gitignore` 里排除，**不要提交、不要截图分享**。NAS 上建议 `chmod 600`。

## 免责

仅供个人账号自动化学习使用。接口行为可能随时变更，签到失败请先重抓 Token；因使用本脚本导致的账号异常请自行承担。
