import { Router, type IRouter } from "express";
import healthRouter from "./health";
import settingsRouter from "./settings";
import reunionsRouter from "./reunions";
import registrationsRouter from "./registrations";
import pollsRouter from "./polls";
import adminRouter from "./admin";
import storageRouter from "./storage";
import vendorsRouter from "./vendors";
import imagesRouter from "./images";

const router: IRouter = Router();

router.use(healthRouter);
router.use(settingsRouter);
router.use(pollsRouter);
router.use(reunionsRouter);
router.use(vendorsRouter);
router.use(imagesRouter);
router.use(registrationsRouter);
// storageRouter must come before adminRouter: admin.ts applies a router-level
// requireAdmin middleware that would swallow any route mounted after it.
router.use(storageRouter);
router.use(adminRouter);

export default router;
