import express from "express";
import cors from "cors";
import { routes } from "./routes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));
app.use("/api", routes);

const PORT = Number(process.env.PORT ?? 5174);
app.listen(PORT, () => {
  console.log(`[ctf-rop] server listening on http://localhost:${PORT}`);
});
