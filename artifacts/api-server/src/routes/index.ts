import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import shipmentsRouter from "./shipments";
import alertsRouter from "./alerts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(ordersRouter);
router.use(shipmentsRouter);
router.use(alertsRouter);

export default router;
