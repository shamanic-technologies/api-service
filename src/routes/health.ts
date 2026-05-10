import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "api-gateway",
    version: "1.0.0",
  });
});

router.get("/", (req, res) => {
  res.json({
    name: "Distribute API",
    version: "1.0.0",
    docs: "https://docs.distribute.you",
  });
});

export default router;
