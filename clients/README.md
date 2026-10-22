# 客户端配置文件

按客户端选一个，装完就行。脚本本体只有一份：`../ninebot-sign.js`，这里只是各客户端的接线方式。

## 一键安装链接

| 客户端 | 文件 | 链接 |
|---|---|---|
| Surge | `ninebot.sgmodule` | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot.sgmodule` |
| Loon | `ninebot.plugin` | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot.plugin` |
| Quantumult X | `ninebot-qx.conf` | `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/clients/ninebot-qx.conf` |
| Stash | `ninebot.sgmodule`（试试） | 同上 Surge 链接 |
| Egern | `ninebot.sgmodule`（试试） | 同上 Surge 链接 |

raw 拉不到就用 jsDelivr，把 `https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/` 换成 `https://cdn.jsdelivr.net/gh/JwOKR/scripts-ninebot@main/`。

> **更新不生效先看这里**：`raw.githubusercontent.com` 带 `Cache-Control: max-age=300`，
> 五分钟内二次拉取会命中 CDN 旧副本；jsDelivr 更狠，`max-age=604800`（7 天），
> **改了配置别用 jsDelivr 拉更新**。客户端里「拉取更新」拿到旧内容时，
> 直接删掉插件重新添加，或在客户端里手改那一行 cron 时间。

## 装完必须做的两件事

1. **开 MITM 并信任证书**（否则抓不到 Token，甚至 App 请求可能异常）。
2. **打开 App 进签到页点一次签到**，收到「获取成功」通知才算抓到账号。

顺序别反：先抓 Token，定时任务才有账号可签。

---

## Surge

模块 → 安装新模块 → 填上面的 sgmodule 链接。

模块里已经包含抓 Token 脚本、每天 12:05 的签到任务、MITM hostname，装完只需开 MITM。

> 模块头部只写了 `#!name` / `#!desc` 两个字段。`#!author` `#!homepage` 之类的元数据在 Surge 模块里不保证被识别，为了不因一个没用的字段导致安装失败，索性不加。

改参数：在「模块」里编辑该模块，把 `argument="LogLevel=info&Retry=2&Interval=800"` 按需改。

手动测试：Surge → 首页 → 脚本 → 找到 `九号出行签到` → 立即运行。

## Loon

配置 → 插件 → 添加插件 → 填上面的 plugin 链接。

`%APPEND%` 会自动把 `cn-cbu-gateway.ninebot.com` 追加进 MITM 列表，不用手改。

## Quantumult X

**两步，缺一不可：**

1. 重写 → 引用 → 添加资源，填 `ninebot-qx.conf` 的链接（只加载重写规则和 MITM）；
2. 编辑你自己的配置文件，在 `[task_local]` 里加一行定时任务：

```ini
5 12 * * * https://raw.githubusercontent.com/JwOKR/scripts-ninebot/main/ninebot-sign.js, tag=九号出行签到, enabled=true
```

QX 不支持远程加载 `[task_local]`，所以这行必须手动加。这一点没有绕过的办法。

重写类型必须是 `script-request-header`，配置里已经写好了，别改成 `script-request-body`。

## Stash / Egern

这两个平台的脚本 API 与 Surge 同族（`$httpClient` / `$persistentStore` / `$notification`），**脚本本体可以直接跑**，但模块文件能不能直接导入我没实机验证过：

- 先试导入 Surge 的 `.sgmodule`，成功就完事；
- 导入失败就按 [../DEPLOY.md](../DEPLOY.md) 第五节手动建 http-request + cron 两条，MITM 加域名。

## Shadowrocket

同理，先在「模块」里试 Surge 模块格式；不行就手动建脚本（Rocket 需 2.2+ 才支持 cron 型脚本）。

---

## 这几个文件我没实机跑过

说清楚边界：

- 脚本本体（`ninebot-sign.js`）在 Node 上做了完整测试，Surge/Loon/QX 的 API 调用是按其文档写的；
- 三个配置文件里，**Surge 模块、Loon 插件、QX 远程重写都没有实机导入验证**（我这边没有这些客户端）。
- 装的时候如果客户端报语法错误，把报错发我，按提示改。语法问题通常很明确（少个逗号、字段名不符），改起来快。

抓 Token 这步能收到通知，就说明 MITM 和重写规则都对了；收不到先查 MITM 证书和 hostname。
