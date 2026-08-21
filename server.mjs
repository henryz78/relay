import { createServer } from "node:http";
import handler from "./api/index.mjs";

const port = Number(process.env.PORT || 3000);
createServer((req, res) => {
  // Adapt Node ServerResponse to Vercel-like res with .status()
  if (typeof res.status !== "function") {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  return handler(req, res);
}).listen(port, () => {
  console.log(`relay listening on ${port}`);
});
