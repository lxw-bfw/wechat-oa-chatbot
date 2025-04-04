/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  const subRouter = router.namespace(`/${process.env.PROJECT_NAME}`);
  subRouter.all('/wechat/handleWechatOaMessage', controller.wechat.handleWechatOaMessage);
  subRouter.all('/wechat/chatR1Stream', controller.wechat.chatR1Stream);

  router.get('/', controller.home.index);
};
