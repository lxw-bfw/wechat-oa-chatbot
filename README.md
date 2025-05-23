# wechat-oa-chatbot

## 说明
给微信公众号接入LLM（deepseek r1、v3、gpt4o...），实现AI聊天问答功能。

扩展功能：联网功能和调用部分工具功能，如查询天气、新闻日报等

## 不同消息类型处理

- [x] 文本消息处理和回复（文本-文本）
- [x] 图片消息处理和回复（图片-文本）
- [x] 语音消息处理和回复（语音-语音）
- [ ] 图片生成和回复图片（生成图片需求-符合需求的图片）



## 被动回复消息的一些问题处理

#### 问题总结

1. **5秒超时限制**：微信服务器在向开发者服务器发送用户消息后，会等待最多5秒的响应。如果5秒内没有收到HTTP 200的响应，微信会认为此次请求失败。
2. **重试机制**：如果5秒超时，微信服务器会进行重试，总共尝试3次（总计约15秒）。如果3次都失败（即15秒内开发者服务器未能成功响应），微信将向用户显示“该公众号提供的服务出现故障，请稍后再试”的默认提示，那么本轮用户的提问，就无法得到应该有的回复
3. **消息内容长度限制**：
   - 文本消息 (text)：回复的文本内容，UTF-8编码，长度限制为**2048字节**（约682个汉字）。
   - 其他类型消息（图片、语音、视频、图文等）也有各自的大小和数量限制。

#### 解决策略

- **超时（第三次重试也即将结束了）仍未能得到大模型接口的回复的处理策略**：
  - 当前论对话用户标记
  - 提供用户提示机制，例如超时后优先回复用户：【正在深入思考中，请稍后回复任意文字尝试获取回复内容...】。用户重新提问后，仍未能提供大模型的答案的情况下，继续提示用户：【您之前的问题AI还在思考哦，请XX秒后再试】
  - 启动对回复内容的异步缓存方案
    - 关联用户
    - 缓存信息字段
      - 核心：status字段，维护一个状态字段，便于处理当前消息生命周期下的不同情况
      - 核心：msgData字段，缓存AI最终的回复内容
    - 合适的缓存失效时间，避免过时的信息堆积，比如用户长时间未回来获取，则自动清除。
    - 缓存库：使用redis
    - 考虑到一次消息生命周期（官方请求只保留5秒，但是会再重试两次）的回复时间利用的一些复杂度，可能会有缓存竞态问题，尽量避免。
  - 设置大模型接口的最终超时处理（保留设置2分钟超时）
    - 避免当前论对话一直循环在“【正在深入思考中，请稍后回复任意文字尝试获取回复内容...】”导致卡死
    - 不论最终大模型接口是否能成功响应，用户都会在超时时间（比如2分钟）后获取到回复的结果，可能是正确的`大模型的答复内容`，也可能是当前回复的`错误原因提示`
- **超出微信官方对自动回复的消息内容长度限制**：
  - **分多条被动回复—基于队列的分段处理**
    - 将AI的长回复按2048字节（或略小，如2000字节，为序号和提示留余地）**分段**（或**切块**），并将这些**片段**存储在一个**队列**中
      - **首次回复**：**出队**第一个片段并发送，在末尾追加提示，例如“（非完整内容，请回复任意文字以获取剩余内容）”。
      - **后续处理：** 关联用户ID，**缓存**当前队列。重复上述**出队**和发送步骤，直到队列**清空**。
- **维护一个关联用户id的回复状态类型缓存字段**，以对多种情况映射不同的策略逻辑
  - 新提问
  - 超时等待回复中
  - 文本过长，获取剩余内容
  - ......

## 其他

- [ ] access_token中控服务
  - **唯一职责**：管理 access_token。
  - **主动刷新**：它会有一个定时任务（如图中“自检测，1个半小时主动刷新一次”），在 access_token 过期前（比如提前10-30分钟）就主动去微信服务器获取新的 access_token，并将其存储起来（比如存到Redis、内存，或数据库）。
  - **被动刷新**：如果由于某种原因（网络问题、微信服务器抖动）主动刷新失败，或者API-Proxy发现当前token已失效，中控服务器应该有能力在被请求时发现token无效并立即尝试刷新。
  - **存储**：安全地存储当前有效的 access_token 及其过期时间。
  - **并发锁**：**极其重要！** 当多个请求同时发现token需要刷新时，必须只有一个请求去执行刷新操作，其他请求等待结果。否则会多次调用微信获取token的接口，可能导致API调用超限或获取到不同的token引发混乱。
  - **提供接口**：具体的业务逻辑方不做任何涉及access_token相关的处理，唯一仅从access_token中控服务获取有效的access_token
- [ ] 支持Docker部署

## QuickStart

<!-- add docs here for user -->

see [egg docs][egg] for more detail.

### Development

```bash
npm i
npm run dev
open http://localhost:7001/
```

### Deploy

```bash
npm start
npm stop
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.

[egg]: https://eggjs.org
