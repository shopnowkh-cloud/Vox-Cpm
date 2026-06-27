import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ttsRouter from "./tts";
import convertRouter from "./convert";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ttsRouter);
router.use(convertRouter);

export default router;
