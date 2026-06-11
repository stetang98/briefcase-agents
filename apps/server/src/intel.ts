import { Router } from "express";
import { intelFor } from "./intelData.js";

export const intelRouter: Router = Router();

intelRouter.get("/api/intel/:topic", (req, res) => {
  res.json(intelFor(req.params.topic));
});
