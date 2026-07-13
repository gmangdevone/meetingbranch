import { Router, type IRouter } from "express";
import healthRouter from "./health";
import registrationsRouter from "./registrations";
import announcementsRouter from "./announcements";
import scheduleRouter from "./schedule";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(registrationsRouter);
router.use(announcementsRouter);
router.use(scheduleRouter);
router.use(adminRouter);

export default router;
