/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  const subRouter = router.namespace(`/${process.env.PROJECT_NAME}`);
  subRouter.get('/wechatmp', controller.wechatmp.verify);

  router.get('/', controller.home.index);
};
