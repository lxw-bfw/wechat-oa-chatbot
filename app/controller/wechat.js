const { Controller } = require('egg');
const crypto = require('crypto');
const xml2js = require('xml2js');

class WechatController extends Controller {
  // 处理微信公众号用户发送的消息
  async handleWechatOaMessage() {
    console.log('微信服务器回调测试');

    const { ctx } = this;
    if (ctx.method === 'GET') {
      console.log('微信回调get请求，开始进行验证');

      const { signature, timestamp, nonce, echostr } = ctx.query;
      const token = 'lxwstrongtoken'; // 必须与公众平台配置一致

      // 排序并拼接字符串
      const tmpArr = [token, timestamp, nonce].sort();
      const tmpStr = tmpArr.join('');
      const sha1 = crypto.createHash('sha1');
      sha1.update(tmpStr);
      const hash = sha1.digest('hex');

      // 验证签名
      if (hash === signature) {
        ctx.body = echostr; // 返回 echostr 表示验证成功
      } else {
        ctx.status = 403; // 验证失败
        ctx.body = 'Forbidden';
      }
      return;
    }

    if (ctx.method === 'POST') {
      // 处理用户消息
      const xml = ctx.request.body;
      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(xml);

      const userMessage = result.xml.Content;
      const fromUser = result.xml.FromUserName;
      const toUser = result.xml.ToUserName;
      console.log('用户消息:', userMessage);
      console.log('发送者:', fromUser);
      console.log('接收者:', toUser);

      // 构造回复XML
      const responseXml = `
        <xml>
          <ToUserName><![CDATA[${fromUser}]]></ToUserName>
          <FromUserName><![CDATA[${toUser}]]></FromUserName>
          <CreateTime>${Date.now()}</CreateTime>
          <MsgType><![CDATA[text]]></MsgType>
          <Content><![CDATA[${'你好，这里是LW服务器接口在回复您'}]]></Content>
        </xml>
      `;

      ctx.type = 'application/xml';
      ctx.body = responseXml;
    }
  }

  // 流式输出模式，微信公众号服务器不支持，仅自己前端使用
  async chatR1Stream() {
    const { ctx } = this;
    ctx.type = 'text/event-stream';
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');

    const prompt = ctx.query.prompt || '你好，介绍一下你自己！';
    try {
      const streamRes = await ctx.service.wechat.chatR1Stream(prompt);

      ctx.body = streamRes;

      // 以下仅为浏览器地址栏快速调试使用

      //   ctx.res.on('close', () => {
      //     streamRes.controller.abort();
      //   });

      //   let isEnterReasoningContent = false; // 标记是否是思考内容
      //   let isEnterContent = false; // 标记是否是最终回答内容

      //   for await (const chunk of streamRes) {
      //     const reasoningContent = chunk.choices[0]?.delta?.reasoning_content || '';
      //     const content = chunk.choices[0]?.delta?.content || '';
      //     if (reasoningContent) {
      //       if (isEnterReasoningContent) {
      //         ctx.res.write(reasoningContent);
      //       } else {
      //         ctx.res.write(`思考中：\n\n ${reasoningContent}`);
      //         isEnterReasoningContent = true;
      //       }
      //     }
      //     if (content) {
      //       if (isEnterContent) {
      //         ctx.res.write(content);
      //       } else {
      //         ctx.res.write(`\n\n 最终回答：\n\n ${content}`);
      //         isEnterContent = true;
      //       }
      //     }
      //   }

      //   // End the response
      //   ctx.res.write('data: [DONE]\n\n');
      //   ctx.res.end();
    } catch (error) {
      // 统一错误处理
      ctx.logger.error('DeepSeek API error:', error);
      ctx.res.write(`data: ${JSON.stringify({ error: 'An error occurred' })}\n\n`);
      ctx.res.end();
    }
  }
}

module.exports = WechatController;
