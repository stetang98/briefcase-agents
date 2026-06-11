import { Router } from "express";
import { intelFor } from "./intelData.js";

const SAFE_TOPIC = /^[a-zA-Z0-9_-]{1,64}$/;

export const intelRouter: Router = Router();

intelRouter.get("/api/intel/:topic", (req, res) => {
  const topic = req.params.topic;
  if (!SAFE_TOPIC.test(topic)) {
    res.status(400).json({ error: "invalid topic: use 1-64 chars [a-zA-Z0-9_-]" });
    return;
  }
  res.json(intelFor(topic));
});
