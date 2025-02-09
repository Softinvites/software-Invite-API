import createError, { HttpError } from "http-errors";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import logger from "morgan";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:3039",
    "http://192.168.0.197:3039",
    "http://100.64.100.6:3039",
    "https://linkorgnet.com.ng",
    "https://www.linkorgnet.com.ng",
  ],
  credentials: true,
};

app.use(express.json());
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(logger("dev"));

app.use(helmet());

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: "Too many requests from this IP, please try again later.",
});

app.use(limiter);

app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
  console.error(err);

  const status = err.status || 500;

  const response = {
    message: err.message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }), 
  };

  res.status(status).json(response); 
});

app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

const url: string =
  process.env.MONGODB_URL || "mongodb://localhost:27017/softinvites";

mongoose
  .connect(url)
  .then(() => console.log("Database connected"))
  .catch((error) => console.log(error));

const port: number | string = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
