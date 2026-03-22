import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import debugRouter from "./debug";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(debugRouter);

export default router;
