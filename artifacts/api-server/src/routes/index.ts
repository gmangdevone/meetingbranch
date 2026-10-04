import { Router, type IRouter } from "express";
import healthRouter from "./health";
import settingsRouter from "./settings";
import reunionsRouter from "./reunions";
import registrationsRouter from "./registrations";
import pollsRouter from "./polls";
import activityChoicesRouter from "./activityChoices";
import adminRouter from "./admin";
import storageRouter from "./storage";
import vendorsRouter from "./vendors";
import imagesRouter from "./images";
import profileRouter from "./profile";
import paymentRecipientsRouter from "./paymentRecipients";

const router: IRouter = Router();

router.use(healthRouter);
// Owner-only payment recipients: mounted early and independent of the admin
// router's global requireAdmin (owner authority never derives from isAdmin).
router.use(paymentRecipientsRouter);
router.use(profileRouter);
router.use(settingsRouter);
router.use(pollsRouter);
router.use(activityChoicesRouter);
router.use(reunionsRouter);
router.use(vendorsRouter);
router.use(imagesRouter);
router.use(registrationsRouter);
// storageRouter must come before adminRouter: admin.ts applies a router-level
// requireAdmin middleware that would swallow any route mounted after it.
router.use(storageRouter);
router.use(adminRouter);

export default router;
