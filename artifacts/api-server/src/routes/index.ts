import { Router, type IRouter } from "express";
import healthRouter from "./health";
import settingsRouter from "./settings";
import reunionsRouter from "./reunions";
import registrationsRouter from "./registrations";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(settingsRouter);
router.use(reunionsRouter);
router.use(registrationsRouter);
router.use(adminRouter);

export default router;
