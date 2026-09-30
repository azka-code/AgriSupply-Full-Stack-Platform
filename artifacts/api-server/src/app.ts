import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const origin = req.get("origin");
  if (!isMutation || !origin) {
    next();
    return;
  }
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    res.status(403).json({ error: { code: "CSRF_REJECTED", message: "Request origin could not be verified." } });
    return;
  }
  const acceptedHosts = [
    req.get("x-forwarded-host")?.split(",")[0]?.trim(),
    req.get("host"),
  ].filter((host): host is string => Boolean(host));
  if (!acceptedHosts.includes(originHost)) {
    res.status(403).json({ error: { code: "CSRF_REJECTED", message: "Request origin could not be verified." } });
    return;
  }
  next();
});

app.use("/api", router);

export default app;
