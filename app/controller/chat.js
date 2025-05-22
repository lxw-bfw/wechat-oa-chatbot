const { Controller } = require('egg');

class WechatController extends Controller {
  // 流式输出模式，微信公众号服务器不支持，仅自己web端使用
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
