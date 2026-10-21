# 九号出行签到脚本 · 代码审查报告

- **被审对象**：`九号出行 签到` v1.0.0（作者 凉心，build 2026-06-18）
- **修复版**：`ninebot-sign.js` v1.1.0
- **审查范围**：功能正确性、跨平台兼容、错误处理、可维护性
- **协议层**：**未改动**。请求路径、Header、Body 字段完全沿用原版，只改工程问题
- **验证方式**：语法检查 + 本地 mock 服务 5 用例 + 真实接口 1 次探测（详见文末）

---

## 一、结论

原版思路是对的，两种模式（MITM 抓 Token / 定时签到）的设计也合理，账号存储格式能用。但有 **3 个会让功能直接失效的问题**，其中 Node.js 分支实际上是跑不起来的，`process.exit(1)` 还会让所有 cron 任务永远报失败。

修复版重写了跨平台 shim（原版 600+ 行压缩代码 → 约 500 行按职责分段的可读版本），补上重试、退避、账号间隔、结果标识，参数从 1 个扩到 6 个。

**风险等级统计**：P0 阻塞 3 项 · P1 计算/体验错误 4 项 · P2 健壮性 6 项

---

## 二、问题清单

| # | 级别 | 位置（原版） | 问题 | 后果 |
|---|---|---|---|---|
| 1 | **P0** | `#d`/`#u` + `require("node-fetch")` | Node.js 分支依赖 `node-fetch`、`fetch-cookie`，但没有任何声明 | `MODULE_NOT_FOUND`，Node 环境完全跑不起来 |
| 2 | **P0** | `r()` → `process.exit(1)` | 无论签到成功与否都退 1 | cron / 监控 / 飞牛定时任务永远判定失败 |
| 3 | **P0** | `#d` 读文件 `JSON.parse(this.fs.readFileSync(t))` | 读的是账号文本，却按 JSON 解析 | 只要有账号数据就抛错，`catch` 后返回 `{}`，**账号丢失** |
| 4 | P1 | `f()` → `1 === s.currentSignStatus` | 严格相等，接口若返回字符串 `"1"` 就判为未签 | 已签账号被重复调签到接口，增加风控风险 |
| 5 | P1 | 主流程 `a.push(await f(s))` | 结果数组只存文本，不存 deviceId | 多账号通知全是「已签 \| 连签 N 天」，分不清是谁 |
| 6 | P1 | `n.getItem` 内无条件 `JSON.parse` | 纯数字/布尔样式的 token 被转成 number/boolean | 类型漂移，写回存储时值被改变 |
| 7 | P1 | 抓 Token 分支 `e!==a` 判断 | 只判断「token 是否变化」但无论变没变都弹「获取成功」 | 每次进签到页都弹通知，噪音，且无法确认是否真的更新 |
| 8 | P2 | `b()` | 无重试、无退避 | 一次 429/5xx/网络抖动直接判「失败」，当天签到丢失 |
| 9 | P2 | `t.timeout=5` | 默认超时 5 秒偏短；各平台单位不统一（Surge/Loon 秒、QX/Node 毫秒） | 弱网下大面积超时；改参数容易踩单位坑 |
| 10 | P2 | `for (const s of e)` | 多账号连续请求零间隔 | 多号用户更容易触发风控 |
| 11 | P2 | `p()` | `indexOf(":")` 切分 + 空 token 不校验 | 若 deviceId 含 `:`（或存储被手工改坏）会串号 |
| 12 | P2 | `f()` 复核 | 签到成功但复核请求失败 → 整个账号抛异常判失败 | 明明签到了却报「失败」，用户会重复操作 |
| 13 | P2 | `case "Worker"` 分支 | 宣称支持 Worker，但 Worker 每次请求是新实例，`n.data` 不持久 | 存储形同虚设，误导使用者 |
| 14 | P2 | 全局 | 单字母类名 `t/a/s/n/b/f/p`、600+ 行压缩、大量未使用工具方法（`count`/`time`/`timeLog`/`merge`/`pick`/`omit`…） | 无法维护，改一行要通读全文 |
| 15 | 争议 | `r({})` in 请求分支 | 见下方单独说明 | — |

### 关于 #15（我要更正自己第一轮的判断）

第一轮我说「QX 下 `$done({})` 会中断请求」，**查证后这句不准确**：QX 在 `script-request-header` 类型下，`$done({})` 是官方语义的「不修改、放行」。所以原版在正确配置下是能用的。

修复版仍然改为回传 `$request`，理由是：

- 语义更明确，不依赖"空对象 = 透传"这个隐含约定；
- 如果哪天被配成 `script-request-body`，`$done({})` 的行为就不再是无害的；
- 对 Surge/Loon/Stash 等仍用 `$done({})`（这些平台确认是空对象=不改动），做平台分支而不是一刀切。

这条从 P0 降级为「争议项」，修复属于加固不是修 bug。

---

## 三、几个关键问题的详细说明

### 3.1 账号丢失（#3，最严重）

原版 `n` 类读文件的分支：

```js
static #d = t => {
  if ("Node.js" !== e) return {};
  // ...
  const e = this.path.resolve(t);           // t = "box.dat"
  if (!s && !o) return {};
  const t = s ? e : a;
  try { return JSON.parse(this.fs.readFileSync(t)); } catch (e) { return {}; }
};
```

`box.dat` 里存的是纯文本（`deviceId:token;...`），`JSON.parse` 必然抛错，于是每次 `getItem` 都返回 `{}` → 读到 0 个账号 → 抓 Token 时 `setItem` 又是「先读、合并、再写」→ 读到的永远是空对象 → **每次抓 Token 都把上一个账号覆盖掉**。

修复版的做法：**账号就是纯字符串，整存整取，不做任何 JSON 转换**。

```js
// Node 环境直接读写文本文件，其它平台走 $persistentStore / $prefs
store.get(STORE_KEY);   // 返回 "id1:tok1;id2:tok2"
store.set(STORE_KEY, "id1:tok1;id2:tok2");
```

### 3.2 Node.js 分支（#1 #2）

原版：

```js
globalThis.fetch || (globalThis.fetch = require("node-fetch"));
globalThis.fetch?.cookieJar || (globalThis.fetch = require("fetch-cookie").default(globalThis.fetch));
// ...
process.exit(1);
```

两个依赖都没在安装说明里出现，`fetch-cookie` 还是默认走的分支（`t["auto-cookie"]` 默认 `undefined` → 落到 `default` → 一定会 require）。加上 `process.exit(1)`，即使手动装好依赖，cron 也永远认为失败。

修复版：Node 18+ 自带 `fetch`，直接用它，加 `AbortController` 做超时，零依赖；退出码按结果给 `process.exitCode = 0/1`。

```js
if (!globalThis.fetch) throw new Error("当前 Node.js 没有内置 fetch，请升级到 18+");
```

### 3.3 状态码类型（#4）

```js
if (1 === s.currentSignStatus) return `已签 | 连签 ${o}天`;   // "1" !== 1
```

Java 后端（九号是 Java 系网关）返 `Integer` 时是数字，但网关序列化层改一次就是字符串。这种隐式依赖不该留。修复版统一 `Number(st.currentSignStatus) === 1`，顺带把 `consecutiveDays` 也 `Number()` 掉（原版直接拼进模板字符串，`undefined` 会打出「连签 undefined天」）。

### 3.4 通知可用性（#5 #7）

原版通知长这样，多号用户根本没法用：

```
已签 | 连签 12天
新签 | 连签 3天 | +5N币
失败
```

修复版：

```
成功 2/3（新签 1 · 已签 1 · 失败 1）
aabbcc…8899 新签 | 连签 4 天 | +5N币
eeee55…8888 已签 | 连签 12 天
123456…cdef 失败: 系统错误（接口返回异常…）
```

`ShowDeviceId=false` 时退化为 `账号#1`，适合截图分享。

### 3.5 重试策略（#8）

分级处理，不是无脑重试：

| 情况 | 行为 |
|---|---|
| 网络错误 / 超时 | 重试，间隔 500ms → 1s → 2s（带随机抖动） |
| `429` / `5xx` | 重试，同上 |
| 其它 `4xx`（401/403/404…） | **不重试**，直接失败——重试只会加重风控 |
| 响应非 JSON | 不重试，报错带上响应前 80 字符 |

重试默认 2 次（共 3 次请求），可用 `Retry=0` 关掉。

### 3.6 实测发现的接口行为（重要）

拿一个假 Token 打了真实接口：

```
GET /portal/api/user-sign/v2/status  →  HTTP 200
{ "code": <非0>, "msg": "系统错误" }
```

**Token 失效时接口不返回 401，而是 200 + 通用「系统错误」。** 这意味着脚本无法可靠区分「Token 过期」和「服务端抖动」。修复版的处理是：状态查询返回 `code != 0` 时，提示语明确说「可能是 Token 失效或服务波动，先重抓 Token 再试」，不假装能确诊。

---

## 四、修复版相对原版的改动清单

| 类别 | 内容 |
|---|---|
| 新增 | 指数退避重试（`Retry`）、请求超时统一秒制（`Timeout`）、多账号间隔+抖动（`Interval`）、结果逐号标识、`ShowDeviceId`、`LogLevel` |
| 修复 | Node 依赖缺失、退出码、账号被 JSON.parse 吞掉、字符串状态码误判、复核失败误报、Token 未变化仍弹通知 |
| 加固 | QX 回传 `$request`、空 token/畸形条目过滤、非 JSON 响应显式报错、通知失败不影响主流程 |
| 移除 | Worker 支持（不可靠）、未使用的工具方法（count/time/timeLog/merge/pick/omit/escape…）、`fetch-cookie` |
| 保留 | 存储键 `Ninebot.Accounts`（升级不丢账号）、请求路径、Header 集合、Body 结构、两种模式切换逻辑 |

### 参数表

| 参数 | 默认 | 范围/取值 | 说明 |
|---|---|---|---|
| `BaseUrl` | `https://cn-cbu-gateway.ninebot.com` | URL | 方便本地 mock 调试 |
| `Timeout` | `10` | 秒 | 单请求超时 |
| `Retry` | `2` | 0–5 | 重试次数 |
| `Interval` | `800` | ms | 多账号间隔（另加 0–400ms 随机抖动） |
| `ShowDeviceId` | `true` | true/false | 通知里是否显示掩码 deviceId |
| `LogLevel` | `info` | off/error/warn/info/debug | 日志级别 |

---

## 五、验证记录

本地 mock 服务跑 5 个用例，全部通过（`node tests/mock-test.js`）：

| 用例 | 验证点 | 结果 |
|---|---|---|
| A | 未签 → POST 签到 → 复核连签天数 → `+5N币` 解析 | PASS |
| B | `currentSignStatus` 返回字符串 `"1"` 时不误签（sign 接口 0 次调用） | PASS |
| C | `503` 连续两次后重试成功（共 3 次请求，退出码 0） | PASS |
| D | `401` 不重试（仅 1 次请求），退出码 1，提示 Token 失效 | PASS |
| E | 双账号逐条标识 + 汇总 `成功 2/2` | PASS |

真接口探测 1 次（假 Token）：HTTP 链路通、JSON 解析正常、错误提示正确、退出码 1。

### 我没法验证、需要你实跑确认的部分

1. **`POST /sign` 的 Body 是否只需要 `deviceId`**。修复版沿用原版，没有改动协议层。如果原版在你账号上能签到成功，修复版也一样；如果原版就签不上，那不是这次的改动范围。
2. **接口是否有签名 / 时间戳校验**。原版没有，我也没有加。
3. **签到接口的真实风控阈值**。`Interval=800ms` 是保守估计，不是抓包得出的结论。
4. 平台侧我只实测了 Node.js。Surge/Loon/QX/Stash/Egern 的 API 调用是按其文档写的（`$httpClient`/`$task.fetch`/`$persistentStore`/`$prefs`），但没有实机跑过——**建议先手动跑一次抓 Token，确认收到「获取成功」通知后再挂定时任务**。

---

## 六、一句话总结

原版能跑，但只在你账号恰好没踩到那几个坑的前提下。修复版把「账号会不会被吞」「失败能不能看出来」「失败后会不会重试」这三件事从"看运气"变成了"确定的"。
