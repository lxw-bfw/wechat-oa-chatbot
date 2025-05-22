/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  const subRouter = router.namespace(`/${process.env.PROJECT_NAME}`);
  subRouter.get('/wechatmp', controller.wechatmp.verify);
  subRouter.post('/wechatmp', controller.wechatmp.handleMessage);

  router.get('/', controller.home.index);
};
