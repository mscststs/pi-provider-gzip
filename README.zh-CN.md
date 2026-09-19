[English](README.md) | [简体中文](README.zh-CN.md)

# pi-provider-gzip

一个 [pi](https://pi.dev) 扩展，通过 **gzip 压缩模型请求体**，在那些接收大请求体缓慢的
LLM 网关上降低首 token 延迟（TTFT）。

```
before:  2.7 MB request body  ──►  gateway chews on it  ──►  ~55–80 s TTFT
after:   0.75 MB gzip body    ──►  gateway chews on it  ──►  ~12–22 s TTFT
```

- **一个开关**即可开启或关闭整个功能（`PI_GZIP=0`）。
- **默认对所有 provider 生效** —— 无需 allowlist，无需逐 provider 配置。
- **按 provider 退出** 写在 provider 自身的设置里：
  `"compat": { "gzip": false }`。

> **为什么有用？** 许多模型中转站（new-api、one-api、LiteLLM 代理、企业网关……）在派发
> 请求前会做与**接收字节数成正比**的工作 —— token 计数、配额预检查、请求体日志、WAF
> 扫描。这部分开销与模型无关，一旦上下文达到数百 KB 就足以主导 TTFT。压缩 JSON 请求体
> 可以缩小这些字节。测量数据见 [`docs/benchmarks.md`](docs/benchmarks.md)。

## 安装

```bash
# 从 git
pi install git:github.com/mscststs/pi-provider-gzip

# 从 npm（发布后）
pi install npm:@mscststs/pi-provider-gzip

# 从本地 checkout
pi install /absolute/path/to/pi-provider-gzip
```

不安装直接试用：

```bash
pi -e /absolute/path/to/pi-provider-gzip
```

安装后，启动一个新会话（或在已有会话中执行 `/reload`）。

## 控制项

### 总开关

| 变量      | 默认值 | 含义                                   |
| --------- | ------ | -------------------------------------- |
| `PI_GZIP` | `1`    | `0` 表示在当前进程内禁用该扩展。       |

```bash
PI_GZIP=0 pi        # 临时禁用全部
```

高级调优（一般无需修改）：

| 变量                | 默认值 | 含义                                       |
| ------------------- | ------ | ------------------------------------------ |
| `PI_GZIP_MIN_BYTES` | `1024` | 只压缩不小于该大小的请求体。               |
| `PI_GZIP_LEVEL`     | `6`    | zlib 级别，钳制到 `0`–`9`。                |
| `PI_GZIP_DEBUG`     | `0`    | 设为 `1` 时每次压缩输出日志到 stderr。     |

```bash
PI_GZIP_DEBUG=1 pi
# [pi-provider-gzip] relay.example 2708795 -> 753098 bytes (3.6x)
```

### 按 provider 退出

拒绝 gzip 请求体的 provider 可以在 `models.json` 中退出：

```json
{
  "providers": {
    "my-relay": {
      "baseUrl": "https://relay.example/v1",
      "api": "openai-completions",
      "apiKey": "...",
      "models": [{ "id": "my-model", "name": "my-model", "contextWindow": 128000 }],
      "compat": { "gzip": false }
    }
  }
}
```

这也适用于内置 provider —— 不需要 `baseUrl`，因为单独的 `compat` 就是合法的 provider
条目：

```json
{
  "providers": {
    "openai": { "compat": { "gzip": false } }
  }
}
```

> `compat` 是 pi 暴露给扩展的唯一 provider 级字段，因此开关放在这里。
> `compat: { "gzip": false }` 表示退出；其他情况一律启用。

## 工作原理

在 `session_start` 时，扩展读取 pi 的实时模型注册表，从所有已配置的 provider 构建一份
host allowlist，并安装**一个进程级的 `fetch` 拦截器**。仅当以下条件**全部**满足时，拦截器
才会压缩请求：

1. 方法是 `POST`；
2. 目标 host 在 allowlist 中（且未被退出）；
3. 请求体是字符串，且长度不小于 `PI_GZIP_MIN_BYTES`。

随后它会 gzip 压缩请求体、设置 `Content-Encoding: gzip`，并删除过时的 `Content-Length`，
让 HTTP 栈重新计算。其他请求一律原样转发。网关会透明解压；模型看到的 JSON 完全一致。

因为钩子位于传输层，它覆盖 **pi 支持的所有基于 fetch 的 API**，无论 provider 是内置还是
用户自定义：

| 已覆盖 | 未覆盖 |
| --- | --- |
| OpenAI Chat Completions / Responses / Azure / Codex (SSE) | Amazon Bedrock（`bedrock-converse-stream`） |
| Anthropic Messages | WebSocket 传输 |
| Mistral Conversations | |
| Google Generative AI / Vertex | |
| pi-messages，以及任意 OpenAI 兼容中转 | |

Bedrock 使用 AWS SDK 的 node:http 传输和 SigV4 签名；WebSocket 传输不经过 `fetch`。
两者均有意不在范围内。

## 兼容性

- **服务端必须接受请求体上的 `Content-Encoding: gzip`。** 大多数网关都支持。若某
  provider 以 `400` 拒绝，请为该 provider 添加 `"compat": { "gzip": false }`。
- **Node：** 需要 Node 22.6+（pi 内置兼容的运行时）。

## 基准测试

在服务大型推理模型、OpenAI 兼容的中转站上，使用真实的 pi 会话测量。完整方法与原始数据
见 [`docs/benchmarks.md`](docs/benchmarks.md)。

| 场景             | 请求体  | 未压缩 TTFT | 压缩后 TTFT    |
| ---------------- | ------- | ----------- | -------------- |
| 全新会话         | 5.7 KB  | 1.5–3.4 s   | 1.4 s          |
| 少量历史         | 20.6 KB | 1.6 s       | 1.6 s          |
| 中等历史         | 377 KB  | 16.4 s      | **3.4 s**      |
| 大量历史         | 1.95 MB | 67.5 s      | —              |
| 超大量历史       | 2.78 MB | 46.8–80.8 s | **11.7–29.4 s** |

中转站本身在任意请求体被 gzip 后都返回**恒定的 ~0.54 s**，而 2 MB 明文请求体则为
**48.6 s**。

## 排错

| 现象 | 可能原因 | 解决 |
| --- | --- | --- |
| 某 provider 返回 `400 Bad Request` | 它不接受 gzip 请求体 | 为该 provider 添加 `"compat": { "gzip": false }`，或设置 `PI_GZIP=0` |
| TTFT 没有变化 | 请求体本来就小，或中转站在计费前就解压了 | 用 `PI_GZIP_DEBUG=1` 检查；收益随请求体大小增长 |
| `Failed to load extension` | Pi 版本不提供此处使用的扩展 API | 升级 pi |
| Bedrock 请求从不被压缩 | AWS SDK 传输，不在范围内 | 预期行为 |

## 开发

```bash
npm install        # 开发依赖：pi-coding-agent、@types/node、typescript
npm run check      # 类型检查 + 单元测试
npm test           # 仅 node --test
```

### 项目结构

```
extensions/
  index.ts               # pi 扩展入口（仅做接线）
lib/
  config.ts              # 总开关 + 调优（纯函数）
  hosts.ts               # 模型注册表 -> host allowlist（纯函数）
  gzip-fetch.ts          # fetch 包装器（纯函数）
  interceptor.ts         # 幂等的全局 fetch 安装/卸载
test/                    # node:test 测试套件
docs/benchmarks.md       # 测量记录
```

## 许可证

[MIT](LICENSE)
